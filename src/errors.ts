/**
 * Error hierarchy for the Datalastic SDK.
 *
 * All SDK errors extend {@link DatalasticError}, so a single catch clause can
 * handle every failure mode while still allowing callers to discriminate on
 * specific subclasses (e.g. credit exhaustion vs. rate limiting).
 */

export class DatalasticError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    // Restore prototype chain for environments that down-compile to ES5.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Raised on HTTP 401 / 403 — invalid, expired, or unauthorized API key. */
export class AuthenticationError extends DatalasticError {
  readonly statusCode: 401 | 403;

  constructor(message: string, statusCode: 401 | 403 = 401) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Raised on HTTP 402 — account credits exhausted. */
export class InsufficientCreditsError extends DatalasticError {
  readonly statusCode: 402 = 402;

  constructor(message: string) {
    super(message);
  }
}

/** Raised on HTTP 404 — requested resource does not exist. */
export class NotFoundError extends DatalasticError {
  readonly statusCode: number;

  constructor(message: string, statusCode = 404) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Raised on HTTP 429 — too many requests. */
export class RateLimitError extends DatalasticError {
  readonly statusCode: 429 = 429;
  /** Seconds to wait before retrying, parsed from the `Retry-After` response header. */
  readonly retryAfter?: number;

  constructor(message: string, retryAfter?: number) {
    super(message);
    this.retryAfter = retryAfter;
  }
}

/** Raised for any other API failure (400, 500, timeouts, malformed bodies). */
export class APIError extends DatalasticError {
  readonly statusCode: number;

  constructor(message: string, statusCode = 0) {
    super(message);
    this.statusCode = statusCode;
  }
}
