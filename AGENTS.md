# Agent Guide

Node.js TypeScript SDK for the Datalastic Maritime API. Dual CJS + ESM build, Node 18+.

## Setup

```bash
npm install
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm test` | Run the Jest suite (offline, fetch mocked) |
| `npm run build` | Build ESM, CJS, and type declarations into `dist/` |
| `npm run build:esm` | ESM build only (`dist/esm/`) |
| `npm run build:cjs` | CJS build only (`dist/cjs/`, writes `package.json` type marker) |
| `npm run build:types` | Emit `.d.ts` only (`dist/types/`) |

On Windows, if `npm test` fails to launch the `.bin` shim, run:
`node --experimental-vm-modules node_modules/jest/bin/jest.js`

## Project structure

```
src/
  index.ts     Public exports
  client.ts    HTTP client, base URLs, single request path, error mapping, _get/_post
  retry.ts     Option validation, Retry-After parsing, backoff and wait capping
  version.ts   SDK_VERSION (generated from package.json)
  vessels.ts   VesselsResource
  ports.ts     PortsResource
  routes.ts    RoutesResource (extended API)
  intel.ts     IntelResource (maritime_reports base)
  reports.ts   ReportsResource (async report jobs)
  models.ts    Response interfaces, ResponseMeta, WithMeta
  errors.ts    Error hierarchy
scripts/
  sync-version.mjs  Rewrites src/version.ts from package.json
tests/
  helpers.ts          Mock responses, fetch spy harness, recording sleep
  client.test.ts      Transport, envelope, meta, config validation, version
  retry.test.ts       Retry policy, wait math
  resources.test.ts   Resource methods, validation, auth table
```

`tsconfig.test.json` is the ts-jest project: it widens `rootDir` to the repo root
so tests can import `tests/helpers.ts`. The build configs are unchanged.

## Key conventions

- **Auth is the `x-api-key` HTTP header.** Both `_get` and `_post` send the key as the `x-api-key` header — never in the query string or POST body. Both methods are marked `@internal` and are excluded from published `.d.ts` declarations — they are used only by resource classes inside this package.
- **Three base URLs.** `BASE_V0` (core), `BASE_EXT` (estimated position, sea routes), `BASE_MR` (intel + reports). `_get(path, base, params)` defaults to `BASE_V0`; pass the base explicitly for the others.
- **Repeated params for bulk.** Array values become repeated query keys (`mmsi=a&mmsi=b`). `vessels.bulk` normalizes `string | string[]` to arrays.
- **`vesselType` maps to `type`.** `vessels.find({ vesselType })` is emitted as `type=` in the query string to avoid clashing with the JS `type` keyword.
- **Validate before fetch.** Every resource method throws `DatalasticError` for missing or invalid args before any network call. Required checks: identifier present (vessels), at least one param (ports, intel), paired `lat`+`lon` (inRadius, routes), both departure and arrival points (routes), non-empty string IDs (reports).
- **Error mapping.** 401/403 → `AuthenticationError`, 402 → `InsufficientCreditsError`, 404 → `NotFoundError`, 429 → `RateLimitError` (reads `Retry-After` header into `.retryAfter?: number`), everything else (timeouts, malformed bodies) → `APIError`.
- **Envelope.** Responses are `{ data, meta }`. Both verbs share one request path: it maps non-2xx statuses to typed errors, raises `APIError` when `meta.success === false` (even on HTTP 200, before the `data` check, so the API's own `meta.message` surfaces), raises `APIError` if `data` is absent, then returns `data` with `meta` attached.
- **`meta` is attached, not merged.** `attachMeta` defines `meta` as a non-enumerable, non-writable own property of the payload, so arrays stay arrays and `Object.keys` / `JSON.stringify` / `toEqual` are unaffected. Every method returns `WithMeta<T>`. Missing `meta` defaults to `{}`.
- **Attachment never mutates destructively and never throws.** The payload is returned untouched, without `meta`, when it is `null` or a primitive, when it is not extensible (frozen or sealed), or when it already owns a `meta` field — the payload's own field wins. `vessels.inRadius` applies the same rule to its `next` assignment. `_getWithMeta` returns `{ data, meta }` so `find` / `inRadius` take the cursor from the envelope itself rather than reading it back off the payload, which keeps pagination correct in all three cases. The guard is descriptor-based: an enumerable own `meta` is API data and wins; a non-enumerable, configurable one is the SDK's own earlier stamp and is refreshed, so a payload object reused across responses always shows the latest envelope. No state is kept between requests. The rule is a descriptor heuristic, not a proof of ownership: a non-enumerable, configurable `meta` planted by something other than the SDK (an accessor on a hand-built mock) matches the same signature and is replaced. `JSON.parse` output can never take that shape, so real responses are unaffected.
- **Pagination.** `vessels.find` returns `{ vessels, next }` and `vessels.inRadius` gains a `next` field; both cursors come from `meta.next` and are `undefined` when absent.
- **One version source.** `src/version.ts` exports `SDK_VERSION`, regenerated by `scripts/sync-version.mjs` from the npm `version` lifecycle script. Every request sends `User-Agent: datalastic-node/<SDK_VERSION>`.
- **ESM source imports use `.js` extensions** (NodeNext). Keep them.

## Retry policy

- Options (all validated at construction, all optional): `maxRetries` (default 3, `0` disables), `backoffMs` (default 500, wait for retry `n` is `backoffMs * 2 ** n`), `maxRetryDelayMs` (default 60000, caps **every** wait), `retryableStatuses` (default `[429]`, entries must be 408, 429, or 500-599), `sleep` (default `setTimeout`, public test hook).
- Network failures and timeouts retry on **GET only** — POST creates report jobs and is not idempotent. Retryable statuses retry on **both** verbs; document the duplicate-report risk when callers opt 5xx in.
- Wait for a retryable status is `Retry-After` when present and parseable (delta-seconds or HTTP-date, read case-insensitively via `response.headers.get`), otherwise backoff; either way capped at `maxRetryDelayMs`. `RateLimitError.retryAfter` is the same value in whole seconds.
- The retried response body is cancelled, never read: only the final response builds the mapped error.
- Invalid options throw `DatalasticError` naming the option, the received value, and the accepted range. `timeout` above `2147483647` is rejected because Node coerces it to 1 ms.

## Releasing

`npm version <bump>` runs the `version` lifecycle script, which regenerates
`src/version.ts` from package.json and stages it, so the published
`SDK_VERSION` and `User-Agent` always match the package. Never edit
`src/version.ts` by hand. Publishing runs from `.github/workflows/publish.yml`
on version tags.

## Testing notes

Tests import `jest` from `@jest/globals` (required under ESM) and use the `installFetchSpy` harness in `tests/helpers.ts`, which spies on `globalThis.fetch` and exposes per-call URL, init, and header accessors. No real network calls and no real waiting: every mock response carries a case-insensitive `headers.get()` alongside its async `json()`, and retry tests inject the `sleep` option as a recording stub and assert the exact millisecond waits. Helpers are imported with a `.js` extension (`./helpers.js`); the Jest `moduleNameMapper` strips it. Coverage spans every resource method's happy path and pre-fetch validation errors, the auth transport table, the envelope and `meta` contract, the retry matrix, and option validation.
