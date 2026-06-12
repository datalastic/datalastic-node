/**
 * HTTP client and entry point for the Datalastic SDK.
 *
 * Authentication note: the API key is supplied as an `x-api-key` HTTP header
 * for both GET and POST requests.
 */

import {
  APIError,
  AuthenticationError,
  DatalasticError,
  InsufficientCreditsError,
  NotFoundError,
  RateLimitError,
} from './errors.js';
import type { ApiStat } from './models.js';
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

const DEFAULT_TIMEOUT_MS = 30_000;

/** Values accepted for query parameters. Arrays are emitted as repeated keys. */
export type QueryParams = Record<
  string,
  string | number | boolean | string[] | undefined
>;

export interface DatalasticOptions {
  /** Request timeout in milliseconds. Defaults to 30000. */
  timeout?: number;
}

export class Datalastic {
  private readonly apiKey: string;
  private readonly timeout: number;

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
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;

    this.vessels = new VesselsResource(this);
    this.ports = new PortsResource(this);
    this.routes = new RoutesResource(this);
    this.intel = new IntelResource(this);
    this.reports = new ReportsResource(this);
  }

  /** Account usage statistics for the configured API key. */
  async stat(): Promise<ApiStat> {
    return this._get<ApiStat>('/stat');
  }

  /**
   * Perform a GET request and return `{ data, meta }` from the response envelope.
   * @internal
   */
  async _getFull<T>(
    path: string,
    base: string = BASE_V0,
    params: QueryParams = {},
  ): Promise<{ data: T; meta: Record<string, unknown> }> {
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
    const url = query ? `${base}${path}?${query}` : `${base}${path}`;
    const response = await this.fetchWithTimeout(url, {
      headers: { 'x-api-key': this.apiKey },
    });
    if (!response.ok) throw await mapErrorResponse(response);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new APIError('Response body was not valid JSON.', response.status);
    }
    if (typeof body !== 'object' || body === null || !('data' in body)) {
      throw new APIError('Malformed API response: missing "data" key.', response.status);
    }
    const b = body as { data: T; meta: Record<string, unknown> };
    return { data: b.data, meta: b.meta ?? {} };
  }

  /**
   * Perform a GET request, unwrap the `{ data, meta }` envelope and return
   * `data`. Throws a typed {@link DatalasticError} subclass on failure.
   * @internal
   */
  async _get<T>(
    path: string,
    base: string = BASE_V0,
    params: QueryParams = {},
  ): Promise<T> {
    return (await this._getFull<T>(path, base, params)).data;
  }

  /**
   * Perform a POST request with a JSON body. The api-key is sent as the
   * `x-api-key` header rather than in the body.
   * @internal
   */
  async _post<T>(
    path: string,
    body: Record<string, unknown>,
    base: string = BASE_V0,
  ): Promise<T> {
    const url = `${base}${path}`;

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
    });
    return this.handleResponse<T>(response);
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new APIError('Request timed out.');
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new APIError(`Network request failed: ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      throw await mapErrorResponse(response);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new APIError('Response body was not valid JSON.', response.status);
    }

    if (
      typeof body !== 'object' ||
      body === null ||
      !('data' in body)
    ) {
      throw new APIError(
        'Malformed API response: missing "data" key.',
        response.status,
      );
    }

    return (body as { data: T }).data;
  }
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
    case 429: {
      const retryAfterRaw = response.headers.get('retry-after');
      const parsed = retryAfterRaw !== null ? parseInt(retryAfterRaw, 10) : NaN;
      return new RateLimitError(
        detail ?? 'Too many requests: rate limit exceeded.',
        Number.isFinite(parsed) ? parsed : undefined,
      );
    }
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
