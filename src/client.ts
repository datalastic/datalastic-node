/**
 * HTTP client and entry point for the Datalastic SDK.
 *
 * Authentication note: the API key is supplied as an `x-api-key` HTTP header
 * for both GET and POST requests.
 *
 * All verbs share a single request path: build the URL, run the retry loop,
 * map non-2xx statuses to typed errors, then unwrap the `{ data, meta }`
 * envelope and attach `meta` to the returned payload. Nothing is kept
 * between requests: the envelope `meta` is returned to callers directly.
 */

import {
  APIError,
  AuthenticationError,
  DatalasticError,
  InsufficientCreditsError,
  NotFoundError,
  RateLimitError,
} from './errors.js';
import type { ApiStat, ResponseMeta, WithMeta } from './models.js';
import {
  backoffMs,
  capWaitMs,
  parseRetryAfterMs,
  parseRetryAfterSeconds,
  resolveConfig,
  type DatalasticOptions,
  type ResolvedConfig,
} from './retry.js';
import { SDK_VERSION } from './version.js';
import { VesselsResource } from './vessels.js';
import { PortsResource } from './ports.js';
import { RoutesResource } from './routes.js';
import { IntelResource } from './intel.js';
import { ReportsResource } from './reports.js';

/** Core v0 endpoints. */
export const BASE_V0 = 'https://api.datalastic.com/api/v0';
/** Extended add-on endpoints (estimated positions, sea routes). */
export const BASE_EXT = 'https://api.datalastic.com/api/ext';
/** Maritime intelligence report endpoints. */
export const BASE_MR = 'https://api.datalastic.com/api/maritime_reports';

/** Value of the `User-Agent` header sent on every request. */
export const USER_AGENT = `datalastic-node/${SDK_VERSION}`;

export type { DatalasticOptions } from './retry.js';

/** Values accepted for query parameters. Arrays are emitted as repeated keys. */
export type QueryParams = Record<
  string,
  string | number | boolean | string[] | undefined
>;

/** A single HTTP attempt, fully described. */
interface RequestSpec {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly body?: string;
  /**
   * Whether network failures and timeouts may be retried. True for GET only:
   * a POST that failed in transit may still have been processed.
   */
  readonly retryTransportFailures: boolean;
}

export class Datalastic {
  private readonly apiKey: string;
  private readonly config: ResolvedConfig;

  readonly vessels: VesselsResource;
  readonly ports: PortsResource;
  readonly routes: RoutesResource;
  readonly intel: IntelResource;
  readonly reports: ReportsResource;

  constructor(apiKey: string, options: DatalasticOptions = {}) {
    if (!apiKey || apiKey.trim() === '') {
      throw new DatalasticError('An API key is required to create a Datalastic client.');
    }
    this.apiKey = apiKey;
    this.config = resolveConfig(options);

    this.vessels = new VesselsResource(this);
    this.ports = new PortsResource(this);
    this.routes = new RoutesResource(this);
    this.intel = new IntelResource(this);
    this.reports = new ReportsResource(this);
  }

  /** Account usage statistics for the configured API key. */
  async stat(): Promise<WithMeta<ApiStat>> {
    return this._get<ApiStat>('/stat');
  }

  /**
   * Perform a GET request, unwrap the `{ data, meta }` envelope and return
   * `data` with `meta` attached. Throws a typed {@link DatalasticError}
   * subclass on failure.
   * @internal
   */
  async _get<T>(
    path: string,
    base: string = BASE_V0,
    params: QueryParams = {},
  ): Promise<WithMeta<T>> {
    return (await this._getWithMeta<T>(path, base, params)).data;
  }

  /**
   * Like {@link _get}, but also returns the envelope `meta` alongside the
   * payload. Resource methods that derive fields from `meta` (pagination
   * cursors) use this so they never have to read `meta` back off a payload
   * that may not have been able to carry it.
   * @internal
   */
  async _getWithMeta<T>(
    path: string,
    base: string = BASE_V0,
    params: QueryParams = {},
  ): Promise<{ data: WithMeta<T>; meta: ResponseMeta }> {
    const { data, meta } = await this.request<T>({
      method: 'GET',
      url: buildUrl(base, path, params),
      retryTransportFailures: true,
    });
    return { data: attachMeta(data, meta), meta };
  }

  /**
   * Perform a POST request with a JSON body. The api-key is sent as the
   * `x-api-key` header rather than in the body. Network failures and timeouts
   * are never retried here because POST creates report jobs.
   * @internal
   */
  async _post<T>(
    path: string,
    body: Record<string, unknown>,
    base: string = BASE_V0,
  ): Promise<WithMeta<T>> {
    const { data, meta } = await this.request<T>({
      method: 'POST',
      url: `${base}${path}`,
      body: JSON.stringify(body),
      retryTransportFailures: false,
    });
    return attachMeta(data, meta);
  }

  /**
   * The one request path for every verb: attempt, decide whether the failure
   * is retryable, wait, repeat. Returns the parsed envelope.
   */
  private async request<T>(spec: RequestSpec): Promise<{ data: T; meta: ResponseMeta }> {
    const config = this.config;

    for (let attempt = 0; ; attempt += 1) {
      const retriesLeft = attempt < config.maxRetries;
      let response: Response;

      try {
        response = await this.sendOnce(spec);
      } catch (failure) {
        if (spec.retryTransportFailures && retriesLeft) {
          await config.sleep(backoffMs(attempt, config.backoffMs, config.maxRetryDelayMs));
          continue;
        }
        throw new APIError(this.transportFailureMessage(failure));
      }

      if (!response.ok) {
        if (config.retryableStatuses.has(response.status) && retriesLeft) {
          const wait = retryWaitMs(response, attempt, config);
          // The body of a retried response is never read; release the socket.
          await discardBody(response);
          await config.sleep(wait);
          continue;
        }
        throw await mapErrorResponse(response);
      }

      return await parseEnvelope<T>(response);
    }
  }

  /** One HTTP attempt with its own timeout and abort controller. */
  private async sendOnce(spec: RequestSpec): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeout);
    try {
      return await fetch(spec.url, {
        method: spec.method,
        headers: this.headers(spec),
        body: spec.body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private headers(spec: RequestSpec): Record<string, string> {
    const headers: Record<string, string> = {
      'x-api-key': this.apiKey,
      'User-Agent': USER_AGENT,
    };
    if (spec.body !== undefined) headers['Content-Type'] = 'application/json';
    return headers;
  }

  private transportFailureMessage(failure: unknown): string {
    if (errorName(failure) === 'AbortError') {
      return `Request timed out after ${this.config.timeout} ms.`;
    }
    return `Network request failed: ${errorMessage(failure)}`;
  }
}

/**
 * Attach the envelope `meta` to a payload as a non-enumerable, non-writable
 * own property.
 *
 * The payload is never mutated destructively and the caller is never made to
 * crash. `meta` is not attached, and the payload is returned untouched, when:
 *
 * - the payload is `null` or a primitive, which cannot hold a property;
 * - the payload is frozen, sealed, or otherwise not extensible;
 * - the payload already owns an *enumerable* `meta` field. `JSON.parse` only
 *   ever produces enumerable properties, so that field is API data and wins.
 *
 * A non-enumerable, configurable own `meta` is treated as this function's own
 * stamp from an earlier call on the same object and is replaced, so the
 * property always reflects the most recent envelope even when a caller (or a
 * test double) hands the same object back for a second response. The descriptor
 * cannot prove ownership: a property with that exact shape planted by something
 * else (an accessor on a hand-built payload) is replaced too. Nothing
 * `JSON.parse` produces can take that shape, so real responses are unaffected.
 *
 * @internal
 */
export function attachMeta<T>(data: T, meta: ResponseMeta): WithMeta<T> {
  if (data === null || (typeof data !== 'object' && typeof data !== 'function')) {
    return data as WithMeta<T>;
  }
  if (!Object.isExtensible(data)) return data as WithMeta<T>;

  const existing = Object.getOwnPropertyDescriptor(data, 'meta');
  if (existing && (existing.enumerable || !existing.configurable)) {
    return data as WithMeta<T>;
  }

  Object.defineProperty(data, 'meta', {
    value: meta,
    enumerable: false,
    writable: false,
    configurable: true,
  });
  return data as WithMeta<T>;
}

/** Build a request URL, emitting array values as repeated query keys. */
function buildUrl(base: string, path: string, params: QueryParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item));
    } else {
      search.append(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `${base}${path}?${query}` : `${base}${path}`;
}

/** How long to wait before retrying a retryable status. */
function retryWaitMs(
  response: Response,
  attempt: number,
  config: ResolvedConfig,
): number {
  const fromHeader = parseRetryAfterMs(response.headers.get('retry-after'), Date.now());
  return fromHeader === undefined
    ? backoffMs(attempt, config.backoffMs, config.maxRetryDelayMs)
    : capWaitMs(fromHeader, config.maxRetryDelayMs);
}

/**
 * Cancel the body of a response we are about to discard. A stream that is
 * already closed or errored rejects here; that is the expected no-op case and
 * cannot affect the retry outcome.
 */
async function discardBody(response: Response): Promise<void> {
  const body = response.body;
  if (!body || typeof body.cancel !== 'function') return;
  await body.cancel().catch(() => undefined);
}

/** Unwrap `{ data, meta }`, raising on an envelope that reports failure. */
async function parseEnvelope<T>(
  response: Response,
): Promise<{ data: T; meta: ResponseMeta }> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new APIError('Response body was not valid JSON.', response.status);
  }

  if (!isRecord(body)) {
    throw new APIError(
      'Malformed API response: expected a JSON object envelope.',
      response.status,
    );
  }

  const meta: ResponseMeta = isRecord(body.meta) ? (body.meta as ResponseMeta) : {};

  // A failed envelope can arrive with HTTP 200 and no `data` key, so this
  // check runs first to surface the API's own message.
  if (meta.success === false) {
    const message =
      typeof meta.message === 'string' && meta.message.trim() !== ''
        ? meta.message
        : `API request failed: the response envelope reported success: false (HTTP ${response.status}).`;
    throw new APIError(message, response.status);
  }

  if (!('data' in body)) {
    throw new APIError('Malformed API response: missing "data" key.', response.status);
  }

  return { data: body.data as T, meta };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read `name` off a thrown value. `fetch` aborts reject with a `DOMException`,
 * which is not an `Error` in every runtime, so `instanceof` is not usable.
 */
function errorName(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'name' in err) {
    return String((err as { name: unknown }).name);
  }
  return '';
}

function errorMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

/** Map a non-2xx HTTP response to the appropriate error subclass. */
async function mapErrorResponse(response: Response): Promise<DatalasticError> {
  const detail = await extractErrorMessage(response);
  const status = response.status;

  switch (status) {
    case 401:
    case 403:
      return new AuthenticationError(
        detail ?? 'Unauthorized: invalid or expired API key.',
        status,
      );
    case 402:
      return new InsufficientCreditsError(
        detail ?? 'Payment required: account credits exhausted.',
      );
    case 404:
      return new NotFoundError(detail ?? 'Resource not found.', status);
    case 429:
      return new RateLimitError(
        detail ?? 'Too many requests: rate limit exceeded.',
        parseRetryAfterSeconds(response.headers.get('retry-after'), Date.now()),
      );
    default:
      return new APIError(
        detail ?? `API request failed with status ${status}.`,
        status,
      );
  }
}

async function extractErrorMessage(
  response: Response,
): Promise<string | undefined> {
  try {
    const body = await response.json();
    if (body && typeof body === 'object') {
      const obj = body as Record<string, unknown>;
      const candidate = obj.message ?? obj.error ?? obj.detail;
      if (typeof candidate === 'string') return candidate;
    }
  } catch {
    // Body was empty or not JSON — fall back to a generic message.
  }
  return undefined;
}
