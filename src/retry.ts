/**
 * Retry policy for the Datalastic SDK: client option validation, `Retry-After`
 * parsing, exponential backoff, and wait capping.
 *
 * Every wait produced here is a finite, non-negative number of milliseconds
 * that is at most `maxRetryDelayMs`, so a hostile or broken `Retry-After`
 * header can never stall a caller.
 */

import { DatalasticError } from './errors.js';

/** Default request timeout in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 30_000;
/** Default number of retries after the first attempt. */
export const DEFAULT_MAX_RETRIES = 3;
/** Default base for exponential backoff, in milliseconds. */
export const DEFAULT_BACKOFF_MS = 500;
/** Default ceiling applied to every wait, in milliseconds. */
export const DEFAULT_MAX_RETRY_DELAY_MS = 60_000;
/** HTTP statuses retried unless the caller overrides the set. */
export const DEFAULT_RETRYABLE_STATUSES: readonly number[] = [429];
/**
 * Largest delay Node's `setTimeout` accepts. Anything above it is silently
 * coerced to 1 ms, which would abort every request immediately, so values
 * above this ceiling are rejected at construction instead.
 */
export const MAX_TIMER_MS = 2_147_483_647;

/** Options accepted by the `Datalastic` constructor. */
export interface DatalasticOptions {
  /**
   * Request timeout in milliseconds, applied per attempt. Must be a finite
   * number in `(0, 2147483647]`. Defaults to 30000.
   */
  timeout?: number;
  /**
   * Number of retries after the first attempt. `0` disables retrying
   * entirely. Must be an integer in `[0, 100]`. Defaults to 3.
   */
  maxRetries?: number;
  /**
   * Base for exponential backoff in milliseconds; the wait before retry `n`
   * (0-based) is `backoffMs * 2 ** n`, capped at `maxRetryDelayMs`. Must be a
   * finite number in `[0, 2147483647]`. Defaults to 500.
   */
  backoffMs?: number;
  /**
   * Ceiling applied to every wait, including one derived from a `Retry-After`
   * header. Must be a finite number in `(0, 2147483647]`. Defaults to 60000.
   */
  maxRetryDelayMs?: number;
  /**
   * HTTP statuses that trigger a retry, on both GET and POST. Each entry must
   * be 408, 429, or in `[500, 599]`. An empty array disables status-based
   * retries and leaves only GET transport retries in place. The set is used
   * verbatim: passing a set without 429 means 429 is not retried. Defaults to
   * `[429]`.
   *
   * Opting 5xx in also applies to POST, which can duplicate a submitted report
   * if the server processed the request before the response failed.
   */
  retryableStatuses?: readonly number[] | ReadonlySet<number>;
  /**
   * Delay function used between attempts. Defaults to a `setTimeout`-based
   * sleep. Exposed as a test hook so suites can exercise retries without
   * actually waiting.
   */
  sleep?: (ms: number) => Promise<void>;
}

/** Validated, fully-populated transport configuration. */
export interface ResolvedConfig {
  readonly timeout: number;
  readonly maxRetries: number;
  readonly backoffMs: number;
  readonly maxRetryDelayMs: number;
  readonly retryableStatuses: ReadonlySet<number>;
  readonly sleep: (ms: number) => Promise<void>;
}

/** Default delay between attempts. */
export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Render a rejected option value for an error message. */
function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint') return `${value}n`;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(describeValue).join(', ')}]`;
  if (value instanceof Set) return `Set {${[...value].map(describeValue).join(', ')}}`;
  if (typeof value === 'function') return 'a function';
  return `a value of type ${typeof value}`;
}

function reject(option: string, value: unknown, accepted: string): never {
  throw new DatalasticError(
    `Invalid option "${option}": received ${describeValue(value)}, expected ${accepted}.`,
  );
}

/** Validate a millisecond option, or return the default when it is absent. */
function resolveMillis(
  option: string,
  value: number | undefined,
  fallback: number,
  allowZero: boolean,
): number {
  if (value === undefined) return fallback;
  const accepted =
    `a finite number ${allowZero ? 'of at least 0' : 'greater than 0'} ` +
    `and at most ${MAX_TIMER_MS}`;
  if (typeof value !== 'number' || !Number.isFinite(value)) reject(option, value, accepted);
  if (allowZero ? value < 0 : value <= 0) reject(option, value, accepted);
  if (value > MAX_TIMER_MS) reject(option, value, accepted);
  return value;
}

/** A status is retryable only if it is a request timeout, a rate limit, or 5xx. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function resolveRetryableStatuses(
  value: DatalasticOptions['retryableStatuses'],
): ReadonlySet<number> {
  if (value === undefined) return new Set(DEFAULT_RETRYABLE_STATUSES);
  const accepted = 'an array or Set of integer statuses, each 408, 429, or in [500, 599]';
  if (!Array.isArray(value) && !(value instanceof Set)) {
    reject('retryableStatuses', value, accepted);
  }
  const statuses = [...(value as Iterable<unknown>)];
  for (const status of statuses) {
    if (typeof status !== 'number' || !Number.isInteger(status) || !isRetryableStatus(status)) {
      reject('retryableStatuses', status, accepted);
    }
  }
  return new Set(statuses as number[]);
}

/** Validate constructor options and fill in defaults. Throws on any bad value. */
export function resolveConfig(options: DatalasticOptions): ResolvedConfig {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    reject('options', options, 'a plain options object');
  }

  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  if (
    typeof maxRetries !== 'number' ||
    !Number.isInteger(maxRetries) ||
    maxRetries < 0 ||
    maxRetries > 100
  ) {
    reject('maxRetries', options.maxRetries, 'an integer between 0 and 100');
  }

  if (options.sleep !== undefined && typeof options.sleep !== 'function') {
    reject('sleep', options.sleep, 'a function taking a millisecond delay');
  }

  return {
    timeout: resolveMillis('timeout', options.timeout, DEFAULT_TIMEOUT_MS, false),
    maxRetries,
    backoffMs: resolveMillis('backoffMs', options.backoffMs, DEFAULT_BACKOFF_MS, true),
    maxRetryDelayMs: resolveMillis(
      'maxRetryDelayMs',
      options.maxRetryDelayMs,
      DEFAULT_MAX_RETRY_DELAY_MS,
      false,
    ),
    retryableStatuses: resolveRetryableStatuses(options.retryableStatuses),
    sleep: options.sleep ?? defaultSleep,
  };
}

/**
 * Clamp a wait into `[0, capMs]`. Non-finite input (an overflowed backoff, a
 * `Retry-After` of a billion years) collapses to the cap.
 */
export function capWaitMs(ms: number, capMs: number): number {
  if (!Number.isFinite(ms)) return capMs;
  if (ms < 0) return 0;
  return Math.min(ms, capMs);
}

/** Exponential backoff for a 0-based attempt index, already capped. */
export function backoffMs(attempt: number, baseMs: number, capMs: number): number {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new DatalasticError(
      `Internal error: backoff attempt must be a non-negative integer, received ${describeValue(attempt)}.`,
    );
  }
  const factor = 2 ** attempt;
  const raw = Number.isFinite(factor) ? baseMs * factor : Number.POSITIVE_INFINITY;
  return capWaitMs(raw, capMs);
}

/**
 * Parse a `Retry-After` header into milliseconds. Accepts the delta-seconds
 * form (digits only) and the HTTP-date form. Returns `undefined` when the
 * header is absent or unparseable, which means "fall back to backoff".
 */
export function parseRetryAfterMs(
  raw: string | null | undefined,
  nowMs: number,
): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  const value = raw.trim();
  if (value === '') return undefined;

  if (/^\d+$/.test(value)) {
    const ms = Number(value) * 1000;
    return Number.isFinite(ms) ? ms : undefined;
  }

  // Every HTTP-date form contains a month and day name. Requiring a letter
  // keeps `Date.parse` from inventing a date for junk such as "-5" or "1.5".
  if (!/[a-z]/i.test(value)) return undefined;

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return undefined;
  return Math.max(0, timestamp - nowMs);
}

/** `Retry-After` in whole seconds, for `RateLimitError.retryAfter`. */
export function parseRetryAfterSeconds(
  raw: string | null | undefined,
  nowMs: number,
): number | undefined {
  const ms = parseRetryAfterMs(raw, nowMs);
  return ms === undefined ? undefined : Math.round(ms / 1000);
}
