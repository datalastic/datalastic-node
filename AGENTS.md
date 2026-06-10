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
  client.ts    HTTP client, base URLs, error mapping, _get/_post
  vessels.ts   VesselsResource
  ports.ts     PortsResource
  routes.ts    RoutesResource (extended API)
  intel.ts     IntelResource (maritime_reports base)
  reports.ts   ReportsResource (async report jobs)
  models.ts    Response interfaces
  errors.ts    Error hierarchy
tests/
  client.test.ts  All tests, fetch mocked via @jest/globals
```

## Key conventions

- **Auth is a query parameter, not a header.** `_get` appends `api-key=` to the URL. `_post` injects `"api-key"` into the JSON body. Both methods are marked `@internal` and are excluded from published `.d.ts` declarations — they are used only by resource classes inside this package.
- **Three base URLs.** `BASE_V0` (core), `BASE_EXT` (estimated position, sea routes), `BASE_MR` (intel + reports). `_get(path, base, params)` defaults to `BASE_V0`; pass the base explicitly for the others.
- **Repeated params for bulk.** Array values become repeated query keys (`mmsi=a&mmsi=b`). `vessels.bulk` normalizes `string | string[]` to arrays.
- **`vesselType` maps to `type`.** `vessels.find({ vesselType })` is emitted as `type=` in the query string to avoid clashing with the JS `type` keyword.
- **Validate before fetch.** Every resource method throws `DatalasticError` for missing or invalid args before any network call. Required checks: identifier present (vessels), at least one param (ports, intel), paired `lat`+`lon` (inRadius, routes), both departure and arrival points (routes), non-empty string IDs (reports).
- **Error mapping.** 401/403 → `AuthenticationError`, 402 → `InsufficientCreditsError`, 404 → `NotFoundError`, 429 → `RateLimitError` (reads `Retry-After` header into `.retryAfter?: number`), everything else (timeouts, malformed bodies) → `APIError`.
- **Envelope.** Responses are `{ data, meta }`; the client returns `data` and raises `APIError` if `data` is absent.
- **ESM source imports use `.js` extensions** (NodeNext). Keep them.

## Testing notes

Tests import `jest` from `@jest/globals` (required under ESM) and spy on `global.fetch`. No real network calls. Mock responses expose an async `json()` and a `headers.get()` method. Every resource method has coverage for both the happy path and all pre-fetch validation errors.
