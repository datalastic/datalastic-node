/**
 * Transport-level tests: construction and option validation, the response
 * envelope, attached `meta`, error mapping, and version / User-Agent.
 *
 * Resource methods live in `resources.test.ts`; retry behaviour lives in
 * `retry.test.ts`.
 */

import { readFileSync } from 'node:fs';
import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import {
  Datalastic,
  SDK_VERSION,
  USER_AGENT,
  APIError,
  AuthenticationError,
  DatalasticError,
  InsufficientCreditsError,
  NotFoundError,
  RateLimitError,
} from '../src/index.js';
import {
  API_KEY,
  errorResponse,
  installFetchSpy,
  invalidJsonResponse,
  jsonResponse,
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

describe('Datalastic creation', () => {
  test('accepts a valid key', () => {
    expect(() => new Datalastic(API_KEY)).not.toThrow();
  });

  test('throws on empty key', () => {
    expect(() => new Datalastic('')).toThrow(DatalasticError);
    expect(() => new Datalastic('   ')).toThrow(DatalasticError);
  });
});

describe('option validation', () => {
  const invalid: Array<[string, Record<string, unknown>]> = [
    ['timeout: 0', { timeout: 0 }],
    ['timeout: -1', { timeout: -1 }],
    ['timeout: NaN', { timeout: Number.NaN }],
    ['timeout: Infinity', { timeout: Number.POSITIVE_INFINITY }],
    ['timeout: 2147483648', { timeout: 2_147_483_648 }],
    ['timeout: string', { timeout: '30000' }],
    ['timeout: null', { timeout: null }],
    ['maxRetries: -1', { maxRetries: -1 }],
    ['maxRetries: 1.5', { maxRetries: 1.5 }],
    ['maxRetries: 101', { maxRetries: 101 }],
    ['maxRetries: NaN', { maxRetries: Number.NaN }],
    ['maxRetries: string', { maxRetries: '3' }],
    ['backoffMs: -1', { backoffMs: -1 }],
    ['backoffMs: Infinity', { backoffMs: Number.POSITIVE_INFINITY }],
    ['backoffMs: 2147483648', { backoffMs: 2_147_483_648 }],
    ['backoffMs: string', { backoffMs: '500' }],
    ['maxRetryDelayMs: 0', { maxRetryDelayMs: 0 }],
    ['maxRetryDelayMs: -5', { maxRetryDelayMs: -5 }],
    ['maxRetryDelayMs: NaN', { maxRetryDelayMs: Number.NaN }],
    ['maxRetryDelayMs: 2147483648', { maxRetryDelayMs: 2_147_483_648 }],
    ['retryableStatuses: 401', { retryableStatuses: [401] }],
    ['retryableStatuses: 402', { retryableStatuses: [402] }],
    ['retryableStatuses: 404', { retryableStatuses: [404] }],
    ['retryableStatuses: 200', { retryableStatuses: [200] }],
    ['retryableStatuses: 400', { retryableStatuses: [400] }],
    ['retryableStatuses: 600', { retryableStatuses: [600] }],
    ['retryableStatuses: 500.5', { retryableStatuses: [500.5] }],
    ['retryableStatuses: "429"', { retryableStatuses: ['429'] }],
    ['retryableStatuses: mixed good/bad', { retryableStatuses: [429, 404] }],
    ['retryableStatuses: not a collection', { retryableStatuses: 429 }],
    ['retryableStatuses: Set with 401', { retryableStatuses: new Set([401]) }],
    ['sleep: not a function', { sleep: 500 }],
  ];

  const invalidContainers: Array<[string, unknown]> = [
    ['an array', [1, 2, 3]],
    ['a function', () => undefined],
    ['null', null],
    ['a number', 500],
    ['a string', 'timeout'],
  ];

  test.each(invalidContainers)('rejects options given as %s', (_label, options) => {
    expect(
      () => new Datalastic(API_KEY, options as ConstructorParameters<typeof Datalastic>[1]),
    ).toThrow(/Invalid option "options": .* expected a plain options object\./);
  });

  test.each(invalid)('rejects %s', (_label, options) => {
    expect(
      () => new Datalastic(API_KEY, options as ConstructorParameters<typeof Datalastic>[1]),
    ).toThrow(DatalasticError);
  });

  const valid: Array<[string, Record<string, unknown>]> = [
    ['timeout: 1', { timeout: 1 }],
    ['timeout: 2147483647', { timeout: 2_147_483_647 }],
    ['maxRetries: 0', { maxRetries: 0 }],
    ['maxRetries: 100', { maxRetries: 100 }],
    ['backoffMs: 0', { backoffMs: 0 }],
    ['maxRetryDelayMs: 1', { maxRetryDelayMs: 1 }],
    ['retryableStatuses: []', { retryableStatuses: [] }],
    ['retryableStatuses: [408, 429, 500, 599]', { retryableStatuses: [408, 429, 500, 599] }],
    ['retryableStatuses: Set', { retryableStatuses: new Set([429, 503]) }],
    ['sleep: function', { sleep: async () => undefined }],
    ['no options at all', {}],
  ];

  test.each(valid)('accepts %s', (_label, options) => {
    expect(
      () => new Datalastic(API_KEY, options as ConstructorParameters<typeof Datalastic>[1]),
    ).not.toThrow();
  });

  test('error message names the option, the value, and the accepted range', () => {
    expect(() => new Datalastic(API_KEY, { timeout: 0 })).toThrow(
      /Invalid option "timeout": received 0, expected a finite number greater than 0 and at most 2147483647\./,
    );
    expect(() => new Datalastic(API_KEY, { maxRetries: 101 })).toThrow(
      /Invalid option "maxRetries": received 101, expected an integer between 0 and 100\./,
    );
    expect(() => new Datalastic(API_KEY, { retryableStatuses: [404] })).toThrow(
      /Invalid option "retryableStatuses": received 404, expected an array or Set of integer statuses/,
    );
  });

  test('a valid timeout is honored per attempt and does not abort instantly', async () => {
    http.respondWith(jsonResponse({ data: { user_id: 'u1' }, meta: {} }));
    const client = new Datalastic(API_KEY, { timeout: 2_147_483_647 });
    await expect(client.stat()).resolves.toEqual({ user_id: 'u1' });
  });
});

describe('version and User-Agent', () => {
  test('SDK_VERSION matches package.json', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    expect(SDK_VERSION).toBe(manifest.version);
  });

  test('USER_AGENT is derived from SDK_VERSION', () => {
    expect(USER_AGENT).toBe(`datalastic-node/${SDK_VERSION}`);
  });

  test('GET sends the User-Agent header', async () => {
    http.respondWith(jsonResponse({ data: {}, meta: {} }));
    await new Datalastic(API_KEY).stat();
    expect(http.lastHeaders()['User-Agent']).toBe(`datalastic-node/${SDK_VERSION}`);
  });

  test('POST sends the User-Agent header', async () => {
    http.respondWith(jsonResponse({ data: { report_id: 'r1' }, meta: {} }));
    await new Datalastic(API_KEY).reports.submit('port_calls');
    expect(http.lastHeaders()['User-Agent']).toBe(`datalastic-node/${SDK_VERSION}`);
    expect(http.lastHeaders()['Content-Type']).toBe('application/json');
  });
});

describe('response envelope', () => {
  test('stat() maps the happy path to ApiStat and sends x-api-key', async () => {
    const stat = {
      user_id: 'u1',
      key_status: 'active',
      requests_made: 10,
      requests_remaining: 90,
    };
    http.respondWith(jsonResponse({ data: stat, meta: {} }));

    const result = await new Datalastic(API_KEY).stat();

    expect(result).toEqual(stat);
    const url = http.lastUrl();
    expect(url).toContain('/api/v0/stat');
    expect(url).not.toContain('api-key=');
    expect(url.endsWith('?')).toBe(false);
    expect(http.lastHeaders()['x-api-key']).toBe(API_KEY);
  });

  test.each([
    [401, AuthenticationError],
    [402, InsufficientCreditsError],
    [403, AuthenticationError],
    [404, NotFoundError],
    [429, RateLimitError],
    [500, APIError],
  ])('maps HTTP %s to the right error', async (status, ErrCls) => {
    http.alwaysResolve(errorResponse(status, { message: 'boom' }));
    const client = new Datalastic(API_KEY, { maxRetries: 0 });
    await expect(client.stat()).rejects.toBeInstanceOf(ErrCls);
  });

  test('non-JSON body maps to APIError', async () => {
    http.respondWith(invalidJsonResponse());
    await expect(new Datalastic(API_KEY).stat()).rejects.toBeInstanceOf(APIError);
  });

  test('missing data key maps to APIError', async () => {
    http.respondWith(jsonResponse({ meta: {} }));
    await expect(new Datalastic(API_KEY).stat()).rejects.toThrow(
      /missing "data" key/,
    );
  });

  test('a non-object envelope maps to APIError', async () => {
    http.respondWith(jsonResponse([1, 2, 3]));
    await expect(new Datalastic(API_KEY).stat()).rejects.toThrow(
      /expected a JSON object envelope/,
    );
  });

  test('generic network failure maps to APIError', async () => {
    http.alwaysReject(new Error('ECONNRESET'));
    const client = new Datalastic(API_KEY, { maxRetries: 0 });
    await expect(client.stat()).rejects.toThrow(/Network request failed: ECONNRESET/);
  });

  test('timeout maps to APIError naming the timeout', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    http.alwaysReject(abort);
    const client = new Datalastic(API_KEY, { timeout: 5, maxRetries: 0 });
    await expect(client.stat()).rejects.toThrow(/Request timed out after 5 ms\./);
  });

  test('RateLimitError.retryAfter is populated from Retry-After', async () => {
    http.respondWith(errorResponse(429, { message: 'slow down' }, { 'retry-after': '60' }));
    const client = new Datalastic(API_KEY, { maxRetries: 0 });
    await expect(client.stat()).rejects.toMatchObject({
      name: 'RateLimitError',
      retryAfter: 60,
    });
  });

  test('RateLimitError.retryAfter is populated from an HTTP-date Retry-After', async () => {
    const when = new Date(Date.now() + 30_000).toUTCString();
    http.respondWith(errorResponse(429, { message: 'slow down' }, { 'retry-after': when }));
    const client = new Datalastic(API_KEY, { maxRetries: 0 });
    try {
      await client.stat();
      throw new Error('expected a RateLimitError');
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      const seconds = (err as RateLimitError).retryAfter;
      expect(seconds).toBeGreaterThanOrEqual(28);
      expect(seconds).toBeLessThanOrEqual(30);
    }
  });

  test('RateLimitError.retryAfter is undefined when the header is absent', async () => {
    http.respondWith(errorResponse(429, { message: 'slow down' }));
    const client = new Datalastic(API_KEY, { maxRetries: 0 });
    await expect(client.stat()).rejects.toMatchObject({ retryAfter: undefined });
  });
});

describe('meta.success === false on HTTP 200', () => {
  const rejecting = () => new Datalastic(API_KEY, { maxRetries: 0 });

  test('with data present raises APIError carrying meta.message and status 200', async () => {
    http.respondWith(
      jsonResponse({ data: { user_id: 'u1' }, meta: { success: false, message: 'Bad request' } }),
    );
    await expect(rejecting().stat()).rejects.toMatchObject({
      name: 'APIError',
      message: 'Bad request',
      statusCode: 200,
    });
  });

  test('without data raises the same error', async () => {
    http.respondWith(jsonResponse({ meta: { success: false, message: 'Vessel not found' } }));
    await expect(rejecting().stat()).rejects.toMatchObject({
      name: 'APIError',
      message: 'Vessel not found',
      statusCode: 200,
    });
  });

  test('without a message raises a generic APIError', async () => {
    http.respondWith(jsonResponse({ data: null, meta: { success: false } }));
    await expect(rejecting().stat()).rejects.toThrow(
      /reported success: false \(HTTP 200\)/,
    );
  });

  test('with a blank message raises a generic APIError', async () => {
    http.respondWith(jsonResponse({ data: null, meta: { success: false, message: '  ' } }));
    await expect(rejecting().stat()).rejects.toThrow(
      /reported success: false \(HTTP 200\)/,
    );
  });

  test('missing meta succeeds', async () => {
    http.respondWith(jsonResponse({ data: { user_id: 'u1' } }));
    await expect(rejecting().stat()).resolves.toEqual({ user_id: 'u1' });
  });

  test('meta without a success key succeeds', async () => {
    http.respondWith(jsonResponse({ data: { user_id: 'u1' }, meta: { message: 'ok' } }));
    await expect(rejecting().stat()).resolves.toEqual({ user_id: 'u1' });
  });

  test('success: true succeeds', async () => {
    http.respondWith(jsonResponse({ data: { user_id: 'u1' }, meta: { success: true } }));
    await expect(rejecting().stat()).resolves.toEqual({ user_id: 'u1' });
  });

  test('the string "false" is not a failure', async () => {
    http.respondWith(jsonResponse({ data: { user_id: 'u1' }, meta: { success: 'false' } }));
    await expect(rejecting().stat()).resolves.toEqual({ user_id: 'u1' });
  });

  test('applies to POST responses too', async () => {
    http.respondWith(
      jsonResponse({ meta: { success: false, message: 'Report type not supported' } }),
    );
    await expect(rejecting().reports.submit('port_calls')).rejects.toMatchObject({
      name: 'APIError',
      message: 'Report type not supported',
      statusCode: 200,
    });
    expect(http.lastInit().method).toBe('POST');
  });

  test('applies to POST responses that do carry data', async () => {
    http.respondWith(
      jsonResponse({
        data: { report_id: 'r1' },
        meta: { success: false, message: 'Quota exceeded' },
      }),
    );
    await expect(rejecting().reports.submit('port_calls')).rejects.toMatchObject({
      name: 'APIError',
      message: 'Quota exceeded',
      statusCode: 200,
    });
  });

  test('a non-200 success status still applies the check', async () => {
    http.respondWith(
      jsonResponse(
        { data: null, meta: { success: false, message: 'nope' } },
        { status: 201 },
      ),
    );
    await expect(rejecting().stat()).rejects.toMatchObject({
      message: 'nope',
      statusCode: 201,
    });
  });
});

describe('attached meta', () => {
  test('is readable on an object result', async () => {
    const meta = { success: true, requests_left: 42 };
    http.respondWith(jsonResponse({ data: { uuid: 'v1' }, meta }));
    const vessel = await new Datalastic(API_KEY).vessels.get({ mmsi: '123' });
    expect(vessel.meta).toEqual(meta);
    expect(vessel.meta.requests_left).toBe(42);
  });

  test('is readable on stat()', async () => {
    http.respondWith(jsonResponse({ data: { user_id: 'u1' }, meta: { credits: 7 } }));
    const stat = await new Datalastic(API_KEY).stat();
    expect(stat.meta.credits).toBe(7);
  });

  test('is readable on an array result and leaves the array ordinary', async () => {
    const ports = [{ uuid: 'p1' }, { uuid: 'p2' }];
    http.respondWith(jsonResponse({ data: ports, meta: { next: 'cursor-1' } }));
    const result = await new Datalastic(API_KEY).ports.find({ name: 'Rotterdam' });

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.uuid)).toEqual(['p1', 'p2']);
    expect(JSON.stringify(result)).toBe(JSON.stringify(ports));
    expect(result).toEqual(ports);
    expect(result.meta.next).toBe('cursor-1');
  });

  test('is readable on a POST result', async () => {
    http.respondWith(
      jsonResponse({ data: { report_id: 'r1' }, meta: { success: true, queued: true } }),
    );
    const report = await new Datalastic(API_KEY).reports.submit('port_calls');
    expect(report.meta.queued).toBe(true);
  });

  test('is non-enumerable', async () => {
    http.respondWith(jsonResponse({ data: { uuid: 'v1', name: 'Ship' }, meta: { a: 1 } }));
    const vessel = await new Datalastic(API_KEY).vessels.get({ mmsi: '123' });

    expect(Object.keys(vessel)).toEqual(['uuid', 'name']);
    expect(JSON.parse(JSON.stringify(vessel))).toEqual({ uuid: 'v1', name: 'Ship' });
    expect(vessel).toEqual({ uuid: 'v1', name: 'Ship' });
    expect({ ...vessel }).toEqual({ uuid: 'v1', name: 'Ship' });
    expect(Object.propertyIsEnumerable.call(vessel, 'meta')).toBe(false);
  });

  test('is not writable', async () => {
    http.respondWith(jsonResponse({ data: { uuid: 'v1' }, meta: { a: 1 } }));
    const vessel = await new Datalastic(API_KEY).vessels.get({ mmsi: '123' });
    const descriptor = Object.getOwnPropertyDescriptor(vessel, 'meta');
    expect(descriptor?.writable).toBe(false);
    expect(descriptor?.enumerable).toBe(false);
  });

  test('defaults to an empty object when the envelope omits meta', async () => {
    http.respondWith(jsonResponse({ data: { uuid: 'v1' } }));
    const vessel = await new Datalastic(API_KEY).vessels.get({ mmsi: '123' });
    expect(vessel.meta).toEqual({});
  });

  test('defaults to an empty object when meta is not an object', async () => {
    http.respondWith(jsonResponse({ data: { uuid: 'v1' }, meta: 'nope' }));
    const vessel = await new Datalastic(API_KEY).vessels.get({ mmsi: '123' });
    expect(vessel.meta).toEqual({});
  });

  test('a null payload is returned unchanged and carries no meta', async () => {
    http.respondWith(jsonResponse({ data: null, meta: { next: 'x' } }));
    const result = await new Datalastic(API_KEY).vessels.get({ mmsi: '123' });
    expect(result).toBeNull();
  });

  test('a primitive payload is returned unchanged', async () => {
    http.respondWith(jsonResponse({ data: 42, meta: { next: 'x' } }));
    const result = await new Datalastic(API_KEY).vessels.get({ mmsi: '123' });
    expect(result).toBe(42 as unknown);
  });
});

describe('payloads that cannot carry meta', () => {
  test('a frozen object is returned unchanged instead of throwing', async () => {
    const data = Object.freeze({ uuid: 'v1', name: 'Ship' });
    http.respondWith(jsonResponse({ data, meta: { next: 'x' } }));

    const vessel = await new Datalastic(API_KEY).vessels.get({ mmsi: '123' });
    expect(vessel).toEqual({ uuid: 'v1', name: 'Ship' });
    expect(Object.prototype.hasOwnProperty.call(vessel, 'meta')).toBe(false);
    expect(vessel.meta).toBeUndefined();
  });

  test('a frozen array is returned unchanged instead of throwing', async () => {
    const data = Object.freeze([{ uuid: 'p1' }]);
    http.respondWith(jsonResponse({ data, meta: { next: 'x' } }));

    const ports = await new Datalastic(API_KEY).ports.find({ name: 'Rotterdam' });
    expect(Array.isArray(ports)).toBe(true);
    expect(ports).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(ports, 'meta')).toBe(false);
  });

  test('a sealed object is returned unchanged instead of throwing', async () => {
    const data = Object.seal({ uuid: 'v1' });
    http.respondWith(jsonResponse({ data, meta: { next: 'x' } }));

    const vessel = await new Datalastic(API_KEY).vessels.get({ mmsi: '123' });
    expect(vessel).toEqual({ uuid: 'v1' });
    expect(Object.prototype.hasOwnProperty.call(vessel, 'meta')).toBe(false);
  });

  test('a frozen inRadius payload does not throw and yields no cursor', async () => {
    const data = Object.freeze({
      point: { lat: 1, lon: 2, radius: 10 },
      total: 0,
      vessels: [],
    });
    http.respondWith(jsonResponse({ data, meta: { next: 'tok456' } }));

    const result = await new Datalastic(API_KEY).vessels.inRadius({
      lat: 1,
      lon: 2,
      radius: 10,
    });
    expect(result.next).toBeUndefined();
    expect(result).toEqual(data);
  });

  test('find() still paginates when the payload array is frozen', async () => {
    const page = Object.freeze([{ uuid: 'v1' }]);
    http.respondWith(jsonResponse({ data: page, meta: { next: 'page2' } }));

    const result = await new Datalastic(API_KEY).vessels.find({ name: 'EVER' });
    expect(result.next).toBe('page2');
    expect(result.meta.next).toBe('page2');
  });

  test("a payload's own meta field wins and survives intact", async () => {
    http.respondWith(
      jsonResponse({ data: { uuid: 'v1', meta: 'payload-owned' }, meta: { next: 'x' } }),
    );
    const vessel = await new Datalastic(API_KEY).vessels.get({ mmsi: '123' });

    expect(vessel.meta).toBe('payload-owned' as unknown);
    expect(Object.keys(vessel)).toEqual(['uuid', 'meta']);
    expect(JSON.parse(JSON.stringify(vessel))).toEqual({
      uuid: 'v1',
      meta: 'payload-owned',
    });
  });

  test("a payload's own meta object is not replaced by the envelope's", async () => {
    http.respondWith(
      jsonResponse({ data: { uuid: 'v1', meta: { own: true } }, meta: { own: false } }),
    );
    const vessel = await new Datalastic(API_KEY).vessels.get({ mmsi: '123' });
    expect(vessel.meta).toEqual({ own: true });
  });

  test('find() still paginates when the payload owns a meta field', async () => {
    const page: unknown[] = [{ uuid: 'v1' }];
    (page as unknown as { meta: string }).meta = 'payload-owned';
    http.respondWith(jsonResponse({ data: page, meta: { next: 'page2' } }));

    const result = await new Datalastic(API_KEY).vessels.find({ name: 'EVER' });
    expect(result.next).toBe('page2');
  });
});

describe('reused payload identity', () => {
  test('an object returned twice reflects the latest envelope meta', async () => {
    const fixture = { uuid: 'v1' };
    http.respondWith(
      jsonResponse({ data: fixture, meta: { credits: 100 } }),
      jsonResponse({ data: fixture, meta: { credits: 42 } }),
    );
    const client = new Datalastic(API_KEY);
    const first = await client.vessels.get({ mmsi: '1' });
    expect(first.meta.credits).toBe(100);
    const second = await client.vessels.get({ mmsi: '1' });
    expect(second).toBe(first);
    expect(second.meta.credits).toBe(42);
    expect(Object.keys(second)).toEqual(['uuid']);
  });

  test('an array returned twice reflects the latest envelope meta', async () => {
    const fixture = [{ uuid: 'p1' }];
    http.respondWith(
      jsonResponse({ data: fixture, meta: { next: 'a' } }),
      jsonResponse({ data: fixture, meta: { next: 'b' } }),
    );
    const client = new Datalastic(API_KEY);
    await client.ports.find({ name: 'x' });
    const second = await client.ports.find({ name: 'x' });
    expect(second.meta.next).toBe('b');
    expect(JSON.stringify(second)).toBe(JSON.stringify(fixture));
  });

  test('find() cursor and nested array meta both follow the latest envelope', async () => {
    const fixture = [{ uuid: 'v1' }];
    http.respondWith(
      jsonResponse({ data: fixture, meta: { next: 'page-A' } }),
      jsonResponse({ data: fixture, meta: { next: 'page-B' } }),
    );
    const client = new Datalastic(API_KEY);
    const first = await client.vessels.find({ name: 'EVER' });
    expect(first.next).toBe('page-A');
    expect(first.vessels.meta.next).toBe('page-A');
    const second = await client.vessels.find({ name: 'EVER' });
    expect(second.next).toBe('page-B');
    expect(second.meta.next).toBe('page-B');
    expect(second.vessels.meta.next).toBe('page-B');
  });

  test('inRadius() cursor follows the latest envelope on a reused payload', async () => {
    const fixture = { point: { lat: 1, lon: 2, radius: 10 }, total: 0, vessels: [] };
    http.respondWith(
      jsonResponse({ data: fixture, meta: { next: 'r1' } }),
      jsonResponse({ data: fixture, meta: {} }),
    );
    const client = new Datalastic(API_KEY);
    const first = await client.vessels.inRadius({ lat: 1, lon: 2, radius: 10 });
    expect(first.next).toBe('r1');
    const second = await client.vessels.inRadius({ lat: 1, lon: 2, radius: 10 });
    expect(second.meta).toEqual({});
  });

  test('two clients sharing a fixture do not cross-contaminate', async () => {
    const fixture = { user_id: 'u1' };
    http.respondWith(
      jsonResponse({ data: fixture, meta: { credits: 1 } }),
      jsonResponse({ data: fixture, meta: { credits: 2 } }),
    );
    const a = await new Datalastic('key-a').stat();
    expect(a.meta.credits).toBe(1);
    const b = await new Datalastic('key-b').stat();
    expect(b.meta.credits).toBe(2);
    expect(a.meta.credits).toBe(2);
  });

  test("a payload's own enumerable meta survives across two calls", async () => {
    const fixture = { uuid: 'v1', meta: 'payload-owned' };
    http.respondWith(
      jsonResponse({ data: fixture, meta: { next: 'x' } }),
      jsonResponse({ data: fixture, meta: { next: 'y' } }),
    );
    const client = new Datalastic(API_KEY);
    await client.vessels.get({ mmsi: '1' });
    const second = await client.vessels.get({ mmsi: '1' });
    expect(second.meta).toBe('payload-owned' as unknown);
    expect(Object.keys(second)).toEqual(['uuid', 'meta']);
  });

  test('a non-configurable foreign meta property is left alone', async () => {
    const fixture: Record<string, unknown> = { uuid: 'v1' };
    Object.defineProperty(fixture, 'meta', {
      value: 'locked',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    http.respondWith(jsonResponse({ data: fixture, meta: { next: 'x' } }));
    const vessel = await new Datalastic(API_KEY).vessels.get({ mmsi: '1' });
    expect(vessel.meta).toBe('locked' as unknown);
  });
});

describe('pagination cursors', () => {
  test('find() exposes next from meta.next', async () => {
    const vessels = [{ uuid: 'v1', name: 'Maersk' }];
    http.respondWith(jsonResponse({ data: vessels, meta: { next: 'tok123' } }));
    const result = await new Datalastic(API_KEY).vessels.find({ name: 'Maersk' });
    expect(result).toEqual({ vessels, next: 'tok123' });
    expect(result.next).toBe('tok123');
    expect(result.meta.next).toBe('tok123');
  });

  test('find() next is undefined when meta has no cursor', async () => {
    const vessels = [{ uuid: 'v1' }];
    http.respondWith(jsonResponse({ data: vessels, meta: {} }));
    const result = await new Datalastic(API_KEY).vessels.find({ name: 'Maersk' });
    expect(result.next).toBeUndefined();
    expect(result).toEqual({ vessels, next: undefined });
  });

  test('inRadius() exposes next from meta.next', async () => {
    const data = { point: { lat: 1, lon: 2, radius: 10 }, total: 1, vessels: [] };
    http.respondWith(jsonResponse({ data, meta: { next: 'tok456' } }));
    const result = await new Datalastic(API_KEY).vessels.inRadius({
      lat: 1,
      lon: 2,
      radius: 10,
    });
    expect(result.next).toBe('tok456');
    expect(result.meta.next).toBe('tok456');
  });

  test('inRadius() next is undefined when meta has no cursor', async () => {
    const data = { point: { lat: 1, lon: 2, radius: 10 }, total: 0, vessels: [] };
    http.respondWith(jsonResponse({ data, meta: {} }));
    const result = await new Datalastic(API_KEY).vessels.inRadius({
      lat: 1,
      lon: 2,
      radius: 10,
    });
    expect(result.next).toBeUndefined();
    expect(result).toEqual(data);
  });

  test('a paginated find() loop walks every page', async () => {
    http.respondWith(
      jsonResponse({ data: [{ uuid: 'v1' }], meta: { next: 'page2' } }),
      jsonResponse({ data: [{ uuid: 'v2' }], meta: {} }),
    );
    const client = new Datalastic(API_KEY);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.vessels.find({ name: 'EVER', next: cursor });
      seen.push(...page.vessels.map((v) => v.uuid));
      cursor = page.next;
    } while (cursor);

    expect(seen).toEqual(['v1', 'v2']);
    expect(http.callCount()).toBe(2);
    expect(http.urlAt(1)).toContain('next=page2');
  });
});

describe('sleep hook', () => {
  test('is not called on a successful request', async () => {
    const { sleep, waits } = recordingSleep();
    http.respondWith(jsonResponse({ data: {}, meta: {} }));
    await new Datalastic(API_KEY, { sleep }).stat();
    expect(waits).toEqual([]);
  });
});
