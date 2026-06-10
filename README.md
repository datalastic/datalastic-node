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
import { Datalastic } from 'datalastic';

const client = new Datalastic(process.env.DATALASTIC_API_KEY!);
```

CommonJS:

```js
const { Datalastic } = require('datalastic');
const client = new Datalastic(process.env.DATALASTIC_API_KEY);
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
const client = new Datalastic(process.env.DATALASTIC_API_KEY!, { timeout: 60_000 });
```

---

## Vessels

### Real-time position

Returns a single `Vessel` with the latest AIS position: identity (`uuid`, `name`, `mmsi`, `imo`, `eni`, `country_iso`, `type`, `type_specific`), position (`lat`, `lon`), movement (`speed` in knots, `course`, `heading`, `navigation_status`), the reported `destination`, and the timestamp of the fix (`last_position_epoch`, `last_position_UTC`).

```ts
const vessel = await client.vessels.get({ mmsi: '477882000' });
console.log(`${vessel.name} is at ${vessel.lat}, ${vessel.lon}`);
```

One of `uuid`, `mmsi`, or `imo` is required.

### Extended position with voyage details

Returns a `VesselPro`, which includes **everything `vessels.get` returns** (identity, position, movement, destination, timestamps) **plus** a voyage layer:

- `current_draught` — reported draught in meters
- `dest_port` / `dest_port_unlocode` — declared destination port name and UN/LOCODE
- `dep_port` / `dep_port_unlocode` — departure port name and UN/LOCODE
- `atd_UTC` / `atd_epoch` — actual time of departure
- `eta_UTC` / `eta_epoch` — estimated time of arrival

```ts
const pro = await client.vessels.pro({ imo: '9525338' });
console.log(pro.destination, pro.eta_UTC);
```

### Dead-reckoned estimated position

Returns a `VesselEstimated`: all fields from `vessels.pro` **plus** `estimated_position: { lat, lon }`. When a vessel goes dark, this is the position dead-reckoned forward from its last known course and speed:

```ts
const est = await client.vessels.estimated({ uuid: 'e7a3c1f2-...' });
console.log(est.estimated_position.lat, est.estimated_position.lon);
```

### Multiple vessels in one call

Returns `{ total, vessels }`, where `vessels` is an array of `Vessel` records (same fields as `vessels.get`) and `total` is the count matched:

```ts
const bulk = await client.vessels.bulk({
  mmsi: ['477882000', '538003876', '219023000'],
});
console.log(bulk.total, bulk.vessels);
```

`mmsi`, `imo`, and `uuid` each accept a single string or an array.

### Vessels within a radius

Returns `{ point: { lat, lon, radius }, total, vessels }`. Each entry in `vessels` is a standard `Vessel` with a `distance` field (nautical miles from center). Pass a center point, a radius in nautical miles, and an optional vessel type:

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

Returns a `VesselHistory`: the vessel's identity fields (`uuid`, `name`, `mmsi`, `imo`, `eni`, `country_iso`, `type`, `type_specific`) plus a `positions` array. Each position holds `lat`, `lon`, `speed`, `course`, `heading`, `destination`, and the timestamp (`last_position_epoch`, `last_position_UTC`):

```ts
const history = await client.vessels.history({ mmsi: '477882000', days: 7 });
```

### Static particulars

Returns a `VesselInfo` with the vessel's static record: identity and flag (`uuid`, `name`, `name_ais`, `mmsi`, `imo`, `eni`, `country_iso`, `country_name`, `callsign`, `type`, `type_specific`), capacity (`gross_tonnage`, `deadweight`, `teu`, `liquid_gas`), dimensions (`length`, `breadth`, `draught_avg`, `draught_max`), performance (`speed_avg`, `speed_max`), and registration (`year_built`, `is_navaid`, `home_port`). Capacity, draught, and speed averages may be `null` when unknown.

```ts
const info = await client.vessels.info({ imo: '9525338' });
console.log(info.gross_tonnage, info.length, info.year_built);
```

### Search the vessel database

Returns an array of `VesselInfo` records — the same static particulars as `vessels.info` (tonnage, deadweight, dimensions, year built, home port, call sign, etc.), one per matching vessel:

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

Returns an array of `Port` records. Each has `uuid`, `port_name`, `country_iso`, `country_name`, `unlocode`, `port_type`, coordinates (`lat`, `lon`), and regional grouping (`area_lvl1`, `area_lvl2`):

```ts
const ports = await client.ports.find({ name: 'Rotterdam' });
```

### Detailed port record

Returns a `PortDetail`: all `Port` fields plus a `terminals` array. Each terminal carries `terminal_code`, `terminal_name`, `company_name`, coordinates (`lat`, `lon`), `url`, and `address`:

```ts
const port = await client.ports.get({ unlocode: 'NLRTM' });
console.log(port.terminals);
```

---

## Sea Routes

Calculate a navigable sea route between two points. Returns a `SeaRoute` of `{ from, route, to }`, where `from` and `to` are GeoJSON point features and `route` is the GeoJSON line of the path. The total distance in nautical miles is at `route.properties.total_dist`. Port UUIDs and UN/LOCODEs are also accepted as origin and destination:

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

Returns `DryDockRecord[]`. Each record has an `id` and covers survey and docking dates (`special_survey_date`, `dry_dock_date`), the IOPP certificate window (`iopp_issue_date`, `iopp_exp_date`), the responsible `technical_manager`, and top-level contact fields (`country_code`, `website`, `email`, `phone`, `address`, `linkedin`), keyed by `imo` and `vessel_name` with `modified_at`:

```ts
const schedule = await client.intel.dryDock({ imo: '9525338' });
```

### Casualty records

Returns `CasualtyRecord[]`. Each record covers a single incident: `casualty_date`, `casualty_type`, and free-text `casualty_details`, tied to `imo` and `vessel_name` with `modified_at`:

```ts
const casualties = await client.intel.casualties({ imo: '9525338', from: '2020-01-01' });
```

### Port state control inspections

Returns `InspectionRecord[]`. Each record covers one PSC inspection: `inspection_date`, `inspection_authority`, `inspection_port`, `inspection_type`, the `detention` value (a string code), deficiency counts and text (`ship_deficiencies`, `deficiency_description`), vessel classification (`vessel_type_code`, `flag_code`), the responsible `technical_ism_manager`, and top-level contact fields (`country_code`, `website`, `email`, `phone`, `address`, `company_imo`):

```ts
const inspections = await client.intel.inspections({ imo: '9525338' });
```

### Sale and purchase deals

Returns `SPDRecord[]`. Each record is a sale-and-purchase transaction: `seller`, `buyer`, price (`sales_price_usd_mio` (nullable), `sales_price_usd/ldt`), `sales_report_date`, `sales_type`, `destination`, vessel particulars (`flag_name`, `vessel_type_code`, `built_year`, `dwt_design`, `gt`, `ldt`), survey dates (`dry_dock_date`, `special_survey_date`), and a `sales_note`:

```ts
const deals = await client.intel.spd({ name: 'EVER ACE' });
```

### Ownership and management

Returns `OwnershipRecord[]`. Each record maps the management chain: `beneficial_owner` (+ `beneficial_owner_country`), `operator` (+ `operator_country`), `technical_manager` (+ `technical_manager_country`, both `string | null`), `commercial_manager` (+ `commercial_manager_country`), plus `flag_name`, `vessel_type_code`, `built_year`, `dwt_design`, the nullable `buyer`, and `class1_code`:

```ts
const ownership = await client.intel.ownership({ beneficial_owner: 'Evergreen Marine' });
```

### Classification society records

Returns `ClassSocietyRecord[]`. Each record holds the class assignment (`class1_code`) alongside vessel classification (`vessel_type_code`, `flag_name`, `built_year`), survey dates (`special_survey_date`, `dry_dock_date`, both `string | null`), hull dimensions (`loa`, `lbp`, `depth`, `beam_moduled`, `draft_design`), tonnages (`gt`, `nt`, `dwt_design`), propulsion (`engine_builder`, `engine_designer`, `propulsion_type_code`), and ownership links (`beneficial_owner` / `beneficial_owner_imo`, `technical_manager` / `technical_manager_imo`):

```ts
const classSociety = await client.intel.classSociety({ imo: '9525338' });
```

### Engine and propulsion

Returns `EngineRecord[]`. Each record describes the main engine: `engine_designation`, `engine_builder`, `engine_designer`, `propulsion_type_code`, and maximum continuous output (`mco` with `mco_unit` and `mco_rpm`), plus `vessel_type_code`, `trading_category_code`, `built_year`, and `gt`:

```ts
const engines = await client.intel.engine({ imo: '9525338' });
console.log(engines[0].engine_designation, engines[0].mco, engines[0].mco_unit);
```

### Company registry

Returns `CompanyRecord[]`. Each record is a maritime company: `short_name`, `long_name`, `company_type`, `company_imo`, `company_status`, `country_code`, contact details (`website`, `email`, `phone`, `address`, `linkedin`), parent linkage (`parent_company_imo`, `parent_company_name`), and `modified_at`:

```ts
const companies = await client.intel.companies({ company_imo: '1234567' });
```

---

## Async Reports

Report jobs run asynchronously. Submit a job, then poll until `status` is `'complete'`.

### Submit a job

Returns a `Report`: `report_id`, `report_type`, `status`, `created_at`, optional `updated_at` and `params`, and a `result_url` that is populated once the job finishes. Use `report_id` to poll:

```ts
const job = await client.reports.submit('port_calls', { imo: '9525338' });
console.log(job.report_id);
```

### Poll for completion

Returns the same `Report` shape, refreshed. Poll until `status === 'complete'`, at which point `result_url` points to the generated output:

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

Returns an array of every `Report` on the account, each with the same shape (`report_id`, `report_type`, `status`, `result_url?`, `created_at`, ...):

```ts
const all = await client.reports.listAll();
```

---

## Error Handling

Every error thrown by the Datalastic Node.js SDK extends `DatalasticError`. You can catch the base class for a catch-all, or branch on subclasses for specific recovery logic.

```ts
import {
  Datalastic,
  DatalasticError,
  AuthenticationError,
  InsufficientCreditsError,
  NotFoundError,
  RateLimitError,
  APIError,
} from 'datalastic';

const client = new Datalastic(process.env.DATALASTIC_API_KEY!);

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

The package exports typed interfaces for every resource. Import them alongside the client:

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
