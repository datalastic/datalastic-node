# Changelog

## 0.2.0

### Breaking

- The client class is now `Datalastic`, with options type `DatalasticOptions`;
  `Client` and `ClientOptions` have been removed. Update imports to
  `import { Datalastic } from 'datalastic'`.
- `vessels.find` returns `{ vessels, next }` instead of a bare array, so search
  results carry their own pagination cursor.

### Improvements

- The API key is sent as an `x-api-key` header instead of in the query string
  or POST body, so it no longer appears in URLs, server access logs, or proxy
  traces.
- Requests retry automatically on rate limits, network errors, and timeouts,
  using exponential backoff that honours the `Retry-After` header. Tune it with
  `maxRetries`, `backoffMs`, `maxRetryDelayMs`, and `retryableStatuses`, or set
  `maxRetries: 0` to switch it off. Network and timeout retries apply to GET
  only, so a submitted report is never sent twice.
- Every result carries the response envelope's `meta` — credit and usage
  counters plus pagination cursors — attached so that `Object.keys` and
  `JSON.stringify` output is unchanged and arrays still behave like arrays.
- `vessels.inRadius` results now include a `next` cursor for paging through
  large radius searches.
- Failures that arrive as HTTP 200 with `meta.success: false` now raise an
  `APIError` carrying the server's message instead of returning an empty
  payload.
- Required parameters are validated before a request is sent, so a bad call
  fails immediately with a clear message instead of spending an API credit.
- Constructor options are validated, with errors naming the option, the value
  received, and the accepted range.

0.1.2 was tagged but never reached npm; its changes are included above.
