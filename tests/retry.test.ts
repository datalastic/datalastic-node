/**
 * Retry policy: unit tests for the wait math in `src/retry.ts` and end-to-end
 * behaviour through the client. Every test injects a recording `sleep`, so the
 * suite never actually waits.
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { Datalastic, APIError, RateLimitError, SDK_VERSION } from '../src/index.js';
import {
  backoffMs,
  capWaitMs,
  parseRetryAfterMs,
  parseRetryAfterSeconds,
  DEFAULT_MAX_RETRY_DELAY_MS,
} from '../src/retry.js';
import {
  API_KEY,
  abortError,
  errorResponse,
  installFetchSpy,
  jsonResponse,
  networkError,
  recordingSleep,
  type FetchHarness,
} from './helpers.js';

let http: FetchHarness;

beforeEach(() => {
  http = installFetchSpy();
});

afterEach(() => {
  http.restore();
});

const OK = () => jsonResponse({ data: { user_id: 'u1' }, meta: {} });

describe('wait math', () => {
  test('backoff doubles per attempt', () => {
    expect(backoffMs(0, 500, 60_000)).toBe(500);
    expect(backoffMs(1, 500, 60_000)).toBe(1000);
    expect(backoffMs(2, 500, 60_000)).toBe(2000);
    expect(backoffMs(3, 500, 60_000)).toBe(4000);
  });

  test('backoff is capped', () => {
    expect(backoffMs(10, 500, 60_000)).toBe(60_000);
    expect(backoffMs(100, 1_000_000, 60_000)).toBe(60_000);
  });

  test('backoff of a zero base is always zero', () => {
    expect(backoffMs(0, 0, 60_000)).toBe(0);
    expect(backoffMs(50, 0, 60_000)).toBe(0);
  });

  test('backoff rejects a negative or fractional attempt', () => {
    expect(() => backoffMs(-1, 500, 60_000)).toThrow(/non-negative integer/);
    expect(() => backoffMs(1.5, 500, 60_000)).toThrow(/non-negative integer/);
  });

  test('capWaitMs clamps into [0, cap]', () => {
    expect(capWaitMs(10, 100)).toBe(10);
    expect(capWaitMs(1000, 100)).toBe(100);
    expect(capWaitMs(-5, 100)).toBe(0);
    expect(capWaitMs(Number.POSITIVE_INFINITY, 100)).toBe(100);
    expect(capWaitMs(Number.NaN, 100)).toBe(100);
  });

  test('every wait is finite and within the cap for random inputs', () => {
    for (let i = 0; i < 500; i += 1) {
      const attempt = Math.floor(Math.random() * 2000);
      const base = Math.random() * 1e9;
      const cap = 1 + Math.random() * 1e6;
      const wait = backoffMs(attempt, base, cap);
      expect(Number.isFinite(wait)).toBe(true);
      expect(wait).toBeGreaterThanOrEqual(0);
      expect(wait).toBeLessThanOrEqual(cap);
    }
  });

  test('parses delta-seconds Retry-After', () => {
    expect(parseRetryAfterMs('2', 0)).toBe(2000);
    expect(parseRetryAfterMs('0', 0)).toBe(0);
    expect(parseRetryAfterMs(' 30 ', 0)).toBe(30_000);
    expect(parseRetryAfterMs('999999', 0)).toBe(999_999_000);
  });

  test('parses HTTP-date Retry-After', () => {
    const now = Date.parse('Wed, 21 Oct 2015 07:28:00 GMT');
    expect(parseRetryAfterMs('Wed, 21 Oct 2015 07:28:03 GMT', now)).toBe(3000);
    // A date in the past never yields a negative wait.
    expect(parseRetryAfterMs('Wed, 21 Oct 2015 07:27:00 GMT', now)).toBe(0);
  });

  test('returns undefined for unparseable or absent Retry-After', () => {
    expect(parseRetryAfterMs('soon', 0)).toBeUndefined();
    expect(parseRetryAfterMs('', 0)).toBeUndefined();
    expect(parseRetryAfterMs('-5', 0)).toBeUndefined();
    expect(parseRetryAfterMs('1.5', 0)).toBeUndefined();
    expect(parseRetryAfterMs(null, 0)).toBeUndefined();
    expect(parseRetryAfterMs(undefined, 0)).toBeUndefined();
  });

  test('seconds form rounds the millisecond value', () => {
    expect(parseRetryAfterSeconds('60', 0)).toBe(60);
    const now = Date.parse('Wed, 21 Oct 2015 07:28:00 GMT');
    expect(parseRetryAfterSeconds('Wed, 21 Oct 2015 07:28:03 GMT', now)).toBe(3);
    expect(parseRetryAfterSeconds('nope', 0)).toBeUndefined();
  });
});

describe('transport failures', () => {
  test('GET retries a network error with exponential backoff, then throws', async () => {
    const { sleep, waits } = recordingSleep();
    http.alwaysReject(networkError('ECONNRESET'));
    const client = new Datalastic(API_KEY, { sleep });

    await expect(client.stat()).rejects.toThrow(/Network request failed: ECONNRESET/);
    expect(http.callCount()).toBe(4);
    expect(waits).toEqual([500, 1000, 2000]);
  });

  test('GET retries a timeout with exponential backoff, then throws', async () => {
    const { sleep, waits } = recordingSleep();
    http.alwaysReject(abortError());
    const client = new Datalastic(API_KEY, { sleep, timeout: 1000 });

    await expect(client.stat()).rejects.toThrow(/Request timed out after 1000 ms\./);
    expect(http.callCount()).toBe(4);
    expect(waits).toEqual([500, 1000, 2000]);
  });

  test('GET returns as soon as an attempt succeeds', async () => {
    const { sleep, waits } = recordingSleep();
    http.respondWith(networkError(), networkError(), OK());
    const client = new Datalastic(API_KEY, { sleep });

    await expect(client.stat()).resolves.toEqual({ user_id: 'u1' });
    expect(http.callCount()).toBe(3);
    expect(waits).toEqual([500, 1000]);
  });

  test('POST is never retried on a network error', async () => {
    const { sleep, waits } = recordingSleep();
    http.alwaysReject(networkError('ECONNRESET'));
    const client = new Datalastic(API_KEY, { sleep });

    await expect(client.reports.submit('port_calls')).rejects.toBeInstanceOf(APIError);
    expect(http.callCount()).toBe(1);
    expect(waits).toEqual([]);
  });

  test('POST is never retried on a timeout', async () => {
    const { sleep, waits } = recordingSleep();
    http.alwaysReject(abortError());
    const client = new Datalastic(API_KEY, { sleep });

    await expect(client.reports.submit('port_calls')).rejects.toThrow(/timed out/);
    expect(http.callCount()).toBe(1);
    expect(waits).toEqual([]);
  });

  test('maxRetries: 0 makes a single attempt', async () => {
    const { sleep, waits } = recordingSleep();
    http.alwaysReject(networkError());
    const client = new Datalastic(API_KEY, { sleep, maxRetries: 0 });

    await expect(client.stat()).rejects.toBeInstanceOf(APIError);
    expect(http.callCount()).toBe(1);
    expect(waits).toEqual([]);
  });

  test('backoff waits are capped by maxRetryDelayMs', async () => {
    const { sleep, waits } = recordingSleep();
    http.alwaysReject(networkError());
    const client = new Datalastic(API_KEY, {
      sleep,
      backoffMs: 10_000,
      maxRetryDelayMs: 15_000,
    });

    await expect(client.stat()).rejects.toBeInstanceOf(APIError);
    expect(waits).toEqual([10_000, 15_000, 15_000]);
  });
});

describe('retryable statuses', () => {
  test('429 on GET is retried and then raises RateLimitError', async () => {
    const { sleep, waits } = recordingSleep();
    http.alwaysResolve(errorResponse(429, { message: 'slow down' }));
    const client = new Datalastic(API_KEY, { sleep });

    await expect(client.stat()).rejects.toBeInstanceOf(RateLimitError);
    expect(http.callCount()).toBe(4);
    expect(waits).toEqual([500, 1000, 2000]);
  });

  test('429 on POST is retried and then raises RateLimitError', async () => {
    const { sleep, waits } = recordingSleep();
    http.alwaysResolve(errorResponse(429, { message: 'slow down' }));
    const client = new Datalastic(API_KEY, { sleep });

    await expect(client.reports.submit('port_calls')).rejects.toBeInstanceOf(
      RateLimitError,
    );
    expect(http.callCount()).toBe(4);
    expect(waits).toEqual([500, 1000, 2000]);
  });

  test('a later successful attempt returns data', async () => {
    const { sleep, waits } = recordingSleep();
    http.respondWith(errorResponse(429), errorResponse(429), OK());
    const client = new Datalastic(API_KEY, { sleep });

    await expect(client.stat()).resolves.toEqual({ user_id: 'u1' });
    expect(http.callCount()).toBe(3);
    expect(waits).toEqual([500, 1000]);
  });

  test('every retried attempt carries the auth and user-agent headers', async () => {
    const { sleep } = recordingSleep();
    http.respondWith(errorResponse(429), networkError(), OK());
    const client = new Datalastic(API_KEY, { sleep });

    await client.stat();
    expect(http.callCount()).toBe(3);
    for (let i = 0; i < 3; i += 1) {
      expect(http.headersAt(i)['x-api-key']).toBe(API_KEY);
      expect(http.headersAt(i)['User-Agent']).toBe(`datalastic-node/${SDK_VERSION}`);
      expect(http.urlAt(i)).not.toContain('api-key');
    }
  });

  test('Retry-After in delta-seconds is honored', async () => {
    const { sleep, waits } = recordingSleep();
    http.respondWith(errorResponse(429, {}, { 'retry-after': '2' }), OK());
    const client = new Datalastic(API_KEY, { sleep });

    await client.stat();
    expect(waits).toEqual([2000]);
  });

  test('Retry-After header lookup is case-insensitive', async () => {
    const { sleep, waits } = recordingSleep();
    http.respondWith(errorResponse(429, {}, { 'Retry-After': '7' }), OK());
    const client = new Datalastic(API_KEY, { sleep });

    await client.stat();
    expect(waits).toEqual([7000]);
  });

  test('Retry-After as an HTTP date is honored', async () => {
    const { sleep, waits } = recordingSleep();
    const when = new Date(Date.now() + 3000).toUTCString();
    http.respondWith(errorResponse(429, {}, { 'retry-after': when }), OK());
    const client = new Datalastic(API_KEY, { sleep });

    await client.stat();
    expect(waits).toHaveLength(1);
    // The header has second granularity, so allow a sub-second tolerance.
    expect(waits[0]).toBeGreaterThanOrEqual(2000);
    expect(waits[0]).toBeLessThanOrEqual(3000);
  });

  test('a huge Retry-After is capped at maxRetryDelayMs', async () => {
    const { sleep, waits } = recordingSleep();
    http.respondWith(errorResponse(429, {}, { 'retry-after': '999999' }), OK());
    const client = new Datalastic(API_KEY, { sleep });

    await client.stat();
    expect(waits).toEqual([DEFAULT_MAX_RETRY_DELAY_MS]);
  });

  test('a huge Retry-After respects a custom cap', async () => {
    const { sleep, waits } = recordingSleep();
    http.respondWith(errorResponse(429, {}, { 'retry-after': '999999' }), OK());
    const client = new Datalastic(API_KEY, { sleep, maxRetryDelayMs: 5000 });

    await client.stat();
    expect(waits).toEqual([5000]);
  });

  test('an unparseable Retry-After falls back to backoff', async () => {
    const { sleep, waits } = recordingSleep();
    http.respondWith(errorResponse(429, {}, { 'retry-after': 'soon' }), OK());
    const client = new Datalastic(API_KEY, { sleep });

    await client.stat();
    expect(waits).toEqual([500]);
  });

  test('a missing Retry-After falls back to backoff', async () => {
    const { sleep, waits } = recordingSleep();
    http.respondWith(errorResponse(429), errorResponse(429), OK());
    const client = new Datalastic(API_KEY, { sleep });

    await client.stat();
    expect(waits).toEqual([500, 1000]);
  });

  test('500 is not retried by default', async () => {
    const { sleep, waits } = recordingSleep();
    http.respondWith(errorResponse(500, { message: 'boom' }));
    const client = new Datalastic(API_KEY, { sleep });

    await expect(client.stat()).rejects.toBeInstanceOf(APIError);
    expect(http.callCount()).toBe(1);
    expect(waits).toEqual([]);
  });

  test('500 is retried when opted in', async () => {
    const { sleep, waits } = recordingSleep();
    http.respondWith(errorResponse(500), errorResponse(500), OK());
    const client = new Datalastic(API_KEY, { sleep, retryableStatuses: [429, 500] });

    await expect(client.stat()).resolves.toEqual({ user_id: 'u1' });
    expect(http.callCount()).toBe(3);
    expect(waits).toEqual([500, 1000]);
  });

  test('503 is retried when opted in', async () => {
    const { sleep, waits } = recordingSleep();
    http.alwaysResolve(errorResponse(503, { message: 'unavailable' }));
    const client = new Datalastic(API_KEY, { sleep, retryableStatuses: [503] });

    await expect(client.stat()).rejects.toBeInstanceOf(APIError);
    expect(http.callCount()).toBe(4);
    expect(waits).toEqual([500, 1000, 2000]);
  });

  test('429 is not retried when the caller omits it from the set', async () => {
    const { sleep, waits } = recordingSleep();
    http.respondWith(errorResponse(429, { message: 'slow down' }));
    const client = new Datalastic(API_KEY, { sleep, retryableStatuses: [500] });

    await expect(client.stat()).rejects.toBeInstanceOf(RateLimitError);
    expect(http.callCount()).toBe(1);
    expect(waits).toEqual([]);
  });

  test('an empty set disables status retries but keeps GET transport retries', async () => {
    const { sleep, waits } = recordingSleep();
    http.respondWith(errorResponse(429));
    const client = new Datalastic(API_KEY, { sleep, retryableStatuses: [] });
    await expect(client.stat()).rejects.toBeInstanceOf(RateLimitError);
    expect(http.callCount()).toBe(1);

    http.restore();
    http = installFetchSpy();
    http.respondWith(networkError(), OK());
    const retrying = new Datalastic(API_KEY, { sleep, retryableStatuses: [] });
    await expect(retrying.stat()).resolves.toEqual({ user_id: 'u1' });
    expect(http.callCount()).toBe(2);
    expect(waits).toEqual([500]);
  });

  test.each([400, 401, 402, 404])(
    'HTTP %s is never retried and never sleeps',
    async (status) => {
      const { sleep, waits } = recordingSleep();
      http.respondWith(errorResponse(status, { message: 'nope' }));
      const client = new Datalastic(API_KEY, { sleep });

      await expect(client.stat()).rejects.toBeInstanceOf(Error);
      expect(http.callCount()).toBe(1);
      expect(waits).toEqual([]);
    },
  );

  test('maxRetries: 0 disables status retries', async () => {
    const { sleep, waits } = recordingSleep();
    http.respondWith(errorResponse(429));
    const client = new Datalastic(API_KEY, { sleep, maxRetries: 0 });

    await expect(client.stat()).rejects.toBeInstanceOf(RateLimitError);
    expect(http.callCount()).toBe(1);
    expect(waits).toEqual([]);
  });

  test('the mapped error comes from the final response only', async () => {
    const { sleep } = recordingSleep();
    http.respondWith(
      errorResponse(429, { message: 'first' }),
      errorResponse(429, { message: 'second' }),
      errorResponse(429, { message: 'third' }),
      errorResponse(429, { message: 'final' }, { 'retry-after': '9' }),
    );
    const client = new Datalastic(API_KEY, { sleep });

    await expect(client.stat()).rejects.toMatchObject({
      message: 'final',
      retryAfter: 9,
    });
  });
});
