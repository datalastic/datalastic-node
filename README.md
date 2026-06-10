# Datalastic Node.js SDK

The Datalastic Node.js SDK is a typed client for the Datalastic Maritime API. It covers real-time vessel tracking, port lookups, sea routing, maritime intelligence records, and async report jobs, with full TypeScript declarations and dual ESM/CommonJS output.

[![npm](https://img.shields.io/npm/v/datalastic)](https://www.npmjs.com/package/datalastic)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Table of Contents

- [Installation](#installation)
- [Authentication](#authentication)
- [Quick Start](#quick-start)
- [Vessels](#vessels)
- [Ports](#ports)
- [Sea Routes](#sea-routes)
- [Intelligence Records](#intelligence-records)
- [Async Reports](#async-reports)
- [Error Handling](#error-handling)
- [TypeScript](#typescript)
- [Development](#development)
- [License](#license)

---

## Installation

```bash
npm install datalastic
```

Node.js 18 or later is required.

---

## Authentication

Pass your API key to the constructor. The Datalastic Node.js SDK attaches it as a query parameter on every request automatically.

```ts
import { Client } from 'datalastic';

const client = new Client(process.env.DATALASTIC_API_KEY!);
```

CommonJS:

```js
const { Client } = require('datalastic');
const client = new Client(process.env.DATALASTIC_API_KEY);
```

**Security:** The API key travels in the URL query string on every GET request. That means it shows up in server access logs and proxy logs. Keep it in an environment variable, do not commit it to version control, and avoid logging request URLs in production.

---

## Quick Start

A quick way to confirm your key is working:

```ts
const stat = await client.stat();
console.log(`Requests remaining: ${stat.requests_remaining}`);
```

`stat()` returns `{ user_id, key_status, requests_made, requests_remaining }`.

You can raise the default 30-second timeout if your environment needs more headroom:

```ts
const client = new Client(process.env.DATALASTIC_API_KEY!, { timeout: 60_000 });
```

---

## Vessels

### Real-time position

```ts
const vessel = await client.vessels.get({ mmsi: '477882000' });
console.log(`${vessel.name} is at ${vessel.lat}, ${vessel.lon}`);
```

One of `uuid`, `mmsi`, or `imo` is required.

### Extended position with voyage details

```ts
const pro = await client.vessels.pro({ imo: '9525338' });
console.log(pro.destination, pro.eta_UTC);
```

### Dead-reckoned estimated position

When a vessel goes dark, the estimated endpoint projects its last known position forward using course and speed:

```ts
const est = await client.vessels.estimated({ uuid: 'e7a3c1f2-...' });
console.log(est.estimated_position.lat, est.estimated_position.lon);
```

### Multiple vessels in one call

```ts
const bulk = await client.vessels.bulk({
  mmsi: ['477882000', '538003876', '219023000'],
});
console.log(bulk.total, bulk.vessels);
```

`mmsi`, `imo`, and `uuid` each accept a single string or an array.

### Vessels within a radius

Pass a center point, a radius in nautical miles, and an optional vessel type:

```ts
const nearby = await client.vessels.inRadius({
  lat: 1.29,
  lon: 103.85,
  radius: 25,
  type: 'Cargo',
});
console.log(nearby.total, nearby.vessels);
```

`lat` and `lon` must always be provided together. You can also center on a port (`port_uuid`, `port_unlocode`) or a vessel identifier.

### Historical track

```ts
const history = await client.vessels.history({ mmsi: '477882000', days: 7 });
```

### Static particulars

Tonnage, dimensions, year built, flag, and call sign:

```ts
const info = await client.vessels.info({ imo: '9525338' });
console.log(info.gross_tonnage, info.length, info.year_built);
```

### Search the vessel database

```ts
const results = await client.vessels.find({
  name: 'EVER',
  vesselType: 'Cargo',
  gross_tonnage_min: 50_000,
});
```

`vesselType` maps to the `type` query parameter internally. The field name avoids colliding with the JavaScript `type` keyword.

---

## Ports

### Search ports

```ts
const ports = await client.ports.find({ name: 'Rotterdam' });
```

### Detailed port record

Returns terminals, coordinates, and area data:

```ts
const port = await client.ports.get({ unlocode: 'NLRTM' });
console.log(port.terminals);
```

---

## Sea Routes

Calculate a navigable sea route between two points. This AIS data API Node.js client also accepts port UUIDs or UN/LOCODEs as origin and destination:

```ts
// By coordinates
const route = await client.routes.calculate({
  lat_from: 51.95,
  lon_from: 4.14,
  lat_to: 1.26,
  lon_to: 103.83,
});
console.log(route.route.properties.total_dist); // nautical miles

// By UN/LOCODE
const route2 = await client.routes.calculate({
  port_unlocode_from: 'NLRTM',
  port_unlocode_to: 'SGSIN',
});

// By port UUID
const route3 = await client.routes.calculate({
  port_uuid_from: 'uuid-of-origin',
  port_uuid_to: 'uuid-of-destination',
});
```

Both a departure and arrival point are required. The SDK throws before making a network call if either is missing.

---

## Intelligence Records

All intel methods return typed arrays of records. At least one parameter is required per method.

### Dry dock and survey schedule

```ts
const schedule = await client.intel.dryDock({ imo: '9525338' });
```

### Casualty records

```ts
const casualties = await client.intel.casualties({ imo: '9525338', from: '2020-01-01' });
```

### Port state control inspections

```ts
const inspections = await client.intel.inspections({ imo: '9525338' });
```

### Sale and purchase deals

```ts
const deals = await client.intel.spd({ name: 'EVER ACE' });
```

### Ownership and management

```ts
const ownership = await client.intel.ownership({ beneficial_owner: 'Evergreen Marine' });
```

### Classification society records

```ts
const classSociety = await client.intel.classSociety({ imo: '9525338' });
```

### Engine and propulsion

```ts
const engines = await client.intel.engine({ imo: '9525338' });
console.log(engines[0].engine_designation, engines[0].mco, engines[0].mco_unit);
```

### Company registry

```ts
const companies = await client.intel.companies({ company_imo: '1234567' });
```

---

## Async Reports

Report jobs run asynchronously. Submit a job, then poll until `status` is `'complete'`.

### Submit a job

```ts
const job = await client.reports.submit('port_calls', { imo: '9525338' });
console.log(job.report_id);
```

### Poll for completion

```ts
let report;
do {
  report = await client.reports.get(job.report_id);
  if (report.status !== 'complete') {
    await new Promise(r => setTimeout(r, 5_000));
  }
} while (report.status !== 'complete');

console.log(report.result_url);
```

### List all reports

```ts
const all = await client.reports.listAll();
```

---

## Error Handling

Every error thrown by the Datalastic Node.js SDK extends `DatalasticError`. You can catch the base class for a catch-all, or branch on subclasses for specific recovery logic.

```ts
import {
  Client,
  DatalasticError,
  AuthenticationError,
  InsufficientCreditsError,
  NotFoundError,
  RateLimitError,
  APIError,
} from 'datalastic';

const client = new Client(process.env.DATALASTIC_API_KEY!);

try {
  const vessel = await client.vessels.get({ mmsi: '477882000' });
  console.log(vessel.name);
} catch (err) {
  if (err instanceof AuthenticationError) {
    console.error('Invalid or expired API key');
  } else if (err instanceof InsufficientCreditsError) {
    console.error('No requests remaining on this key');
  } else if (err instanceof NotFoundError) {
    console.error('Vessel not found');
  } else if (err instanceof RateLimitError) {
    const wait = err.retryAfter ?? 60;
    console.error(`Rate limited. Retry after ${wait}s`);
  } else if (err instanceof APIError) {
    console.error('API or network error:', err.message);
  } else {
    throw err;
  }
}
```

| HTTP status | Error class |
|---|---|
| 401 / 403 | `AuthenticationError` |
| 402 | `InsufficientCreditsError` |
| 404 | `NotFoundError` |
| 429 | `RateLimitError` (`.retryAfter?: number` from the `Retry-After` header) |
| 400, 500, timeout, malformed body | `APIError` |

Validation errors (missing required fields) throw `DatalasticError` before any network call is made.

---

## TypeScript

The package exports typed interfaces for every resource. This is a TypeScript maritime API client — import the types alongside the client:

```ts
import type {
  Vessel,
  VesselPro,
  VesselEstimated,
  VesselInfo,
  VesselHistory,
  VesselBulkResult,
  VesselInRadiusResult,
  Port,
  PortDetail,
  SeaRoute,
  ApiStat,
  Report,
  DryDockRecord,
  CasualtyRecord,
  InspectionRecord,
  SPDRecord,
  OwnershipRecord,
  ClassSocietyRecord,
  EngineRecord,
  CompanyRecord,
} from 'datalastic';
```

The package ships `.d.ts` declaration files for both the ESM and CJS entry points, so TypeScript resolves types without any extra `tsconfig` configuration.

---

## Development

```bash
npm install
npm test          # offline, fetch mocked
npm run build     # ESM + CJS + type declarations into dist/
```

On Windows, if `npm test` fails to launch the Jest shim, run it directly:

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js
```

---

## License

MIT. See [LICENSE](./LICENSE).
