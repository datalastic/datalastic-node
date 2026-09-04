/**
 * Shared test fixtures: mock `Response` builders, a `fetch` spy harness, and a
 * recording sleep stub. No test in this suite performs real I/O or waits.
 */

import { jest } from '@jest/globals';

export const API_KEY = 'test-key';

/** Case-insensitive header bag matching the `Headers.get` contract. */
function headerBag(headers: Record<string, string>): { get(name: string): string | null } {
  const lower: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) lower[key.toLowerCase()] = value;
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

/** A successful (or arbitrary-status) mock response with a JSON body. */
export function jsonResponse(
  data: unknown,
  init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {},
): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: headerBag(init.headers ?? {}),
    json: async () => data,
  } as unknown as Response;
}

/** A failed mock response with a JSON body and optional headers. */
export function errorResponse(
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {},
): Response {
  return {
    ok: false,
    status,
    headers: headerBag(headers),
    json: async () => body,
  } as unknown as Response;
}

/** A response whose body is not JSON. */
export function invalidJsonResponse(status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headerBag({}),
    json: async () => {
      throw new Error('not json');
    },
  } as unknown as Response;
}

/** The rejection `fetch` produces when our own abort controller fires. */
export function abortError(): Error {
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
}

/** A transport-level rejection (connection reset, DNS failure, ...). */
export function networkError(message = 'ECONNRESET'): Error {
  return new Error(message);
}

/** A `sleep` stub that records requested delays instead of waiting. */
export function recordingSleep(): {
  sleep: (ms: number) => Promise<void>;
  waits: number[];
} {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
}

/** Minimal view of the jest mock functions this harness drives. */
interface MockView {
  mock: { calls: unknown[][] };
  mockResolvedValueOnce(value: unknown): unknown;
  mockRejectedValueOnce(value: unknown): unknown;
  mockResolvedValue(value: unknown): unknown;
  mockRejectedValue(value: unknown): unknown;
  mockImplementation(fn: (...args: unknown[]) => unknown): unknown;
  mockRestore(): void;
}

export interface FetchHarness {
  /** Number of fetch calls made so far. */
  callCount(): number;
  /** URL of call `index`; negative indexes count back from the last call. */
  urlAt(index: number): string;
  /** Init object of call `index`. */
  initAt(index: number): RequestInit;
  /** Headers of call `index`. */
  headersAt(index: number): Record<string, string>;
  lastUrl(): string;
  lastInit(): RequestInit;
  lastHeaders(): Record<string, string>;
  /** Queue per-call outcomes; an `Error` is queued as a rejection. */
  respondWith(...outcomes: Array<Response | Error>): void;
  /** Answer every call with the same response. */
  alwaysResolve(response: Response): void;
  /** Reject every call with the same error. */
  alwaysReject(error: unknown): void;
  restore(): void;
}

/** Install a `fetch` spy and return accessors over its recorded calls. */
export function installFetchSpy(): FetchHarness {
  const spy = jest.spyOn(globalThis, 'fetch') as unknown as MockView;

  const callAt = (index: number): unknown[] => {
    const calls = spy.mock.calls;
    const resolved = index < 0 ? calls.length + index : index;
    const call = calls[resolved];
    if (!call) {
      throw new Error(
        `No fetch call at index ${index}; ${calls.length} call(s) were recorded.`,
      );
    }
    return call;
  };

  const initAt = (index: number): RequestInit =>
    (callAt(index)[1] ?? {}) as RequestInit;

  return {
    callCount: () => spy.mock.calls.length,
    urlAt: (index) => String(callAt(index)[0]),
    initAt,
    headersAt: (index) => (initAt(index).headers ?? {}) as Record<string, string>,
    lastUrl: () => String(callAt(-1)[0]),
    lastInit: () => initAt(-1),
    lastHeaders: () => (initAt(-1).headers ?? {}) as Record<string, string>,
    respondWith: (...outcomes) => {
      for (const outcome of outcomes) {
        if (outcome instanceof Error) spy.mockRejectedValueOnce(outcome);
        else spy.mockResolvedValueOnce(outcome);
      }
      spy.mockImplementation((...args: unknown[]) => {
        throw new Error(
          `Unexpected extra fetch call to ${String(args[0])}: the queue was exhausted.`,
        );
      });
    },
    alwaysResolve: (response) => spy.mockResolvedValue(response) as unknown as void,
    alwaysReject: (error) => spy.mockRejectedValue(error) as unknown as void,
    restore: () => spy.mockRestore(),
  };
}
