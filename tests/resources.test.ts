/**
 * Resource-level tests: every method's happy path, every pre-fetch validation
 * rule, and a table-driven assertion that the API key travels only in the
 * `x-api-key` header.
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { Datalastic, DatalasticError } from '../src/index.js';
import { API_KEY, installFetchSpy, jsonResponse, type FetchHarness } from './helpers.js';

let http: FetchHarness;

beforeEach(() => {
  http = installFetchSpy();
});

afterEach(() => {
  http.restore();
});

function client(): Datalastic {
  return new Datalastic(API_KEY);
}

describe('vessels.get()', () => {
  test('happy path', async () => {
    const vessel = { uuid: 'v1', name: 'Ship', mmsi: '123' };
    http.respondWith(jsonResponse({ data: vessel, meta: {} }));
    const result = await client().vessels.get({ mmsi: '123' });
    expect(result).toEqual(vessel);
    expect(http.lastUrl()).toContain('/vessel?');
    expect(http.lastUrl()).toContain('mmsi=123');
  });

  test('throws when no identifier provided', async () => {
    await expect(client().vessels.get({})).rejects.toBeInstanceOf(DatalasticError);
    expect(http.callCount()).toBe(0);
  });
});

describe('vessels.pro()', () => {
  test('happy path', async () => {
    const pro = { uuid: 'v1', current_draught: 5 };
    http.respondWith(jsonResponse({ data: pro, meta: {} }));
    const result = await client().vessels.pro({ imo: '9999999' });
    expect(result).toEqual(pro);
    expect(http.lastUrl()).toContain('/vessel_pro?');
    expect(http.lastUrl()).toContain('imo=9999999');
  });

  test('throws when no identifier provided', async () => {
    await expect(client().vessels.pro({})).rejects.toBeInstanceOf(DatalasticError);
    expect(http.callCount()).toBe(0);
  });
});

describe('vessels.bulk()', () => {
  test('sends repeated mmsi params', async () => {
    http.respondWith(jsonResponse({ data: { total: 2, vessels: [] }, meta: {} }));
    await client().vessels.bulk({ mmsi: ['111', '222'] });
    const url = http.lastUrl();
    expect(url).toContain('/vessel_bulk?');
    expect((url.match(/mmsi=/g) || []).length).toBe(2);
    expect(url).toContain('mmsi=111');
    expect(url).toContain('mmsi=222');
  });

  test('accepts a single string mmsi', async () => {
    http.respondWith(jsonResponse({ data: { total: 1, vessels: [] }, meta: {} }));
    await client().vessels.bulk({ mmsi: '111' });
    expect((http.lastUrl().match(/mmsi=/g) || []).length).toBe(1);
  });

  test('throws when nothing provided', async () => {
    await expect(client().vessels.bulk({})).rejects.toBeInstanceOf(DatalasticError);
    expect(http.callCount()).toBe(0);
  });
});

describe('vessels.inRadius()', () => {
  test('happy path', async () => {
    const data = { point: { lat: 1, lon: 2, radius: 10 }, total: 0, vessels: [] };
    http.respondWith(jsonResponse({ data, meta: {} }));
    const result = await client().vessels.inRadius({ lat: 1, lon: 2, radius: 10 });
    expect(result).toEqual(data);
    expect(http.lastUrl()).toContain('radius=10');
  });

  test('throws when radius missing', async () => {
    await expect(
      // @ts-expect-error intentionally omitting radius
      client().vessels.inRadius({ lat: 1, lon: 2 }),
    ).rejects.toBeInstanceOf(DatalasticError);
    expect(http.callCount()).toBe(0);
  });

  test('throws when no center point', async () => {
    await expect(client().vessels.inRadius({ radius: 10 })).rejects.toBeInstanceOf(
      DatalasticError,
    );
    expect(http.callCount()).toBe(0);
  });

  test('throws when lat provided without lon', async () => {
    await expect(
      client().vessels.inRadius({ lat: 1, radius: 10 }),
    ).rejects.toBeInstanceOf(DatalasticError);
    expect(http.callCount()).toBe(0);
  });

  test('throws when lon provided without lat', async () => {
    await expect(
      client().vessels.inRadius({ lon: 2, radius: 10 }),
    ).rejects.toBeInstanceOf(DatalasticError);
    expect(http.callCount()).toBe(0);
  });

  test('accepts a port as the center point', async () => {
    const data = { point: { lat: 1, lon: 2, radius: 5 }, total: 0, vessels: [] };
    http.respondWith(jsonResponse({ data, meta: {} }));
    await client().vessels.inRadius({ port_unlocode: 'NLRTM', radius: 5 });
    expect(http.lastUrl()).toContain('port_unlocode=NLRTM');
  });
});

describe('vessels.history()', () => {
  test('happy path', async () => {
    const data = { uuid: 'v1', positions: [] };
    http.respondWith(jsonResponse({ data, meta: {} }));
    const result = await client().vessels.history({ uuid: 'v1', days: 3 });
    expect(result).toEqual(data);
    expect(http.lastUrl()).toContain('/vessel_history?');
    expect(http.lastUrl()).toContain('days=3');
  });

  test('throws when no identifier provided', async () => {
    await expect(client().vessels.history({ days: 3 })).rejects.toBeInstanceOf(
      DatalasticError,
    );
    expect(http.callCount()).toBe(0);
  });
});

describe('vessels.info()', () => {
  test('happy path', async () => {
    const data = { uuid: 'v1', name: 'Ship', gross_tonnage: 5000 };
    http.respondWith(jsonResponse({ data, meta: {} }));
    const result = await client().vessels.info({ imo: '9999999' });
    expect(result).toEqual(data);
    expect(http.lastUrl()).toContain('/vessel_info?');
  });

  test('throws when no identifier provided', async () => {
    await expect(client().vessels.info({})).rejects.toBeInstanceOf(DatalasticError);
    expect(http.callCount()).toBe(0);
  });
});

describe('vessels.find()', () => {
  test('maps vesselType to the type query param', async () => {
    http.respondWith(jsonResponse({ data: [], meta: {} }));
    const result = await client().vessels.find({ vesselType: 'Cargo' });
    const url = http.lastUrl();
    expect(url).toContain('type=Cargo');
    expect(url).not.toContain('vesselType');
    expect(result.vessels).toEqual([]);
  });

  test('happy path with name returns VesselFindResult', async () => {
    const vessels = [{ uuid: 'v1', name: 'Maersk' }];
    http.respondWith(jsonResponse({ data: vessels, meta: { next: 'tok123' } }));
    const result = await client().vessels.find({ name: 'Maersk' });
    expect(result).toEqual({ vessels, next: 'tok123' });
  });

  test('throws when no search param', async () => {
    await expect(client().vessels.find({})).rejects.toBeInstanceOf(DatalasticError);
    expect(http.callCount()).toBe(0);
  });

  test('throws when only fuzzy is provided', async () => {
    await expect(client().vessels.find({ fuzzy: 1 })).rejects.toBeInstanceOf(
      DatalasticError,
    );
    expect(http.callCount()).toBe(0);
  });

  test('throws when only next is provided', async () => {
    await expect(client().vessels.find({ next: 'token' })).rejects.toBeInstanceOf(
      DatalasticError,
    );
    expect(http.callCount()).toBe(0);
  });
});

describe('vessels.estimated()', () => {
  test('uses the extended base URL', async () => {
    const data = { uuid: 'v1', estimated_position: { lat: 1, lon: 2 } };
    http.respondWith(jsonResponse({ data, meta: {} }));
    await client().vessels.estimated({ uuid: 'v1' });
    expect(http.lastUrl()).toContain('/api/ext/vessel_pro_est');
  });

  test('throws when no identifier provided', async () => {
    await expect(client().vessels.estimated({})).rejects.toBeInstanceOf(DatalasticError);
    expect(http.callCount()).toBe(0);
  });
});

describe('ports', () => {
  test('find() happy path', async () => {
    const data = [{ uuid: 'p1', port_name: 'Rotterdam' }];
    http.respondWith(jsonResponse({ data, meta: {} }));
    const result = await client().ports.find({ name: 'Rotterdam' });
    expect(result).toEqual(data);
    expect(http.lastUrl()).toContain('/port_find?');
  });

  test('find() throws when no params', async () => {
    await expect(client().ports.find({})).rejects.toBeInstanceOf(DatalasticError);
    expect(http.callCount()).toBe(0);
  });

  test('get() returns PortDetail with terminals', async () => {
    const data = {
      uuid: 'p1',
      port_name: 'Rotterdam',
      terminals: [{ terminal_code: 'T1', terminal_name: 'Main' }],
    };
    http.respondWith(jsonResponse({ data, meta: {} }));
    const result = await client().ports.get({ uuid: 'p1' });
    expect(result.terminals).toHaveLength(1);
    expect(http.lastUrl()).toContain('/port?');
  });

  test('get() throws when no identifier', async () => {
    await expect(client().ports.get({})).rejects.toBeInstanceOf(DatalasticError);
    expect(http.callCount()).toBe(0);
  });
});

describe('routes.calculate()', () => {
  test('uses the extended base URL', async () => {
    const data = { from: {}, route: { properties: { total_dist: 100 } }, to: {} };
    http.respondWith(jsonResponse({ data, meta: {} }));
    await client().routes.calculate({ lat_from: 1, lon_from: 2, lat_to: 3, lon_to: 4 });
    expect(http.lastUrl()).toContain('/api/ext/sea_routes');
  });

  test('throws when no departure point', async () => {
    await expect(
      client().routes.calculate({ lat_to: 3, lon_to: 4 }),
    ).rejects.toBeInstanceOf(DatalasticError);
    expect(http.callCount()).toBe(0);
  });

  test('throws when no arrival point', async () => {
    await expect(
      client().routes.calculate({ lat_from: 1, lon_from: 2 }),
    ).rejects.toBeInstanceOf(DatalasticError);
    expect(http.callCount()).toBe(0);
  });

  test('throws when no params at all', async () => {
    await expect(client().routes.calculate({})).rejects.toBeInstanceOf(DatalasticError);
    expect(http.callCount()).toBe(0);
  });

  test('accepts port identifiers instead of lat/lon', async () => {
    const data = { from: {}, route: { properties: { total_dist: 50 } }, to: {} };
    http.respondWith(jsonResponse({ data, meta: {} }));
    await client().routes.calculate({
      port_unlocode_from: 'NLRTM',
      port_unlocode_to: 'SGSIN',
    });
    expect(http.lastUrl()).toContain('/api/ext/sea_routes');
  });
});

describe('intel', () => {
  const mr = '/api/maritime_reports';

  test('dryDock()', async () => {
    http.respondWith(jsonResponse({ data: [], meta: {} }));
    await client().intel.dryDock({ imo: '9999999' });
    expect(http.lastUrl()).toContain(`${mr}/dry_dock_dates`);
  });

  test('dryDock() throws when no params', async () => {
    await expect(client().intel.dryDock({})).rejects.toBeInstanceOf(DatalasticError);
    expect(http.callCount()).toBe(0);
  });

  test('casualties()', async () => {
    http.respondWith(jsonResponse({ data: [], meta: {} }));
    await client().intel.casualties({ imo: '9999999' });
    expect(http.lastUrl()).toContain(`${mr}/casualty`);
  });

  test('casualties() throws when no params', async () => {
    await expect(client().intel.casualties({})).rejects.toBeInstanceOf(DatalasticError);
    expect(http.callCount()).toBe(0);
  });

  test('inspections()', async () => {
    http.respondWith(jsonResponse({ data: [], meta: {} }));
    await client().intel.inspections({ imo: '9999999' });
    expect(http.lastUrl()).toContain(`${mr}/inspections`);
  });

  test('inspections() throws when no params', async () => {
    await expect(client().intel.inspections({})).rejects.toBeInstanceOf(DatalasticError);
    expect(http.callCount()).toBe(0);
  });

  test('spd()', async () => {
    http.respondWith(jsonResponse({ data: [], meta: {} }));
    await client().intel.spd({ imo: '9999999' });
    expect(http.lastUrl()).toContain(`${mr}/spd`);
  });

  test('spd() throws when no params', async () => {
    await expect(client().intel.spd({})).rejects.toBeInstanceOf(DatalasticError);
    expect(http.callCount()).toBe(0);
  });

  test('ownership()', async () => {
    http.respondWith(jsonResponse({ data: [], meta: {} }));
    await client().intel.ownership({ imo: '9999999' });
    expect(http.lastUrl()).toContain(`${mr}/ownership`);
  });

  test('ownership() throws when no params', async () => {
    await expect(client().intel.ownership({})).rejects.toBeInstanceOf(DatalasticError);
    expect(http.callCount()).toBe(0);
  });

  test('classSociety()', async () => {
    http.respondWith(jsonResponse({ data: [], meta: {} }));
    await client().intel.classSociety({ imo: '9999999' });
    expect(http.lastUrl()).toContain(`${mr}/class_society`);
  });

  test('classSociety() throws when no params', async () => {
    await expect(client().intel.classSociety({})).rejects.toBeInstanceOf(DatalasticError);
    expect(http.callCount()).toBe(0);
  });

  test('engine()', async () => {
    http.respondWith(jsonResponse({ data: [], meta: {} }));
    await client().intel.engine({ imo: '9999999' });
    expect(http.lastUrl()).toContain(`${mr}/engine`);
  });

  test('engine() throws when no params', async () => {
    await expect(client().intel.engine({})).rejects.toBeInstanceOf(DatalasticError);
    expect(http.callCount()).toBe(0);
  });

  test('companies()', async () => {
    http.respondWith(jsonResponse({ data: [], meta: {} }));
    await client().intel.companies({ company_imo: '1234567' });
    expect(http.lastUrl()).toContain(`${mr}/companies`);
  });

  test('companies() throws when no params', async () => {
    await expect(client().intel.companies({})).rejects.toBeInstanceOf(DatalasticError);
    expect(http.callCount()).toBe(0);
  });
});

describe('reports', () => {
  test('submit() POSTs to the maritime_reports base without the key in the body', async () => {
    const data = {
      report_id: 'r1',
      report_type: 'inradius_history',
      status: 'pending',
      created_at: 'now',
    };
    http.respondWith(jsonResponse({ data, meta: {} }));
    const result = await client().reports.submit('inradius_history', { imo: '9999999' });
    expect(result).toEqual(data);

    const init = http.lastInit();
    expect(init.method).toBe('POST');
    expect(http.lastHeaders()['x-api-key']).toBe(API_KEY);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body['api-key']).toBeUndefined();
    expect(body.report_type).toBe('inradius_history');
    expect(body.imo).toBe('9999999');
    expect(http.lastUrl()).not.toContain('api-key=');
    expect(http.lastUrl()).toContain('/api/maritime_reports/report');
  });

  test('submit() throws on empty reportType', async () => {
    await expect(client().reports.submit('')).rejects.toBeInstanceOf(DatalasticError);
    expect(http.callCount()).toBe(0);
  });

  test('get() happy path uses the maritime_reports base', async () => {
    const data = { report_id: 'r1', status: 'done', created_at: 'now' };
    http.respondWith(jsonResponse({ data, meta: {} }));
    const result = await client().reports.get('r1');
    expect(result).toEqual(data);
    expect(http.lastUrl()).toContain('report_id=r1');
    expect(http.lastUrl()).toContain('/api/maritime_reports/report');
  });

  test('get() throws on empty reportId', async () => {
    await expect(client().reports.get('')).rejects.toBeInstanceOf(DatalasticError);
    expect(http.callCount()).toBe(0);
  });

  test('listAll() uses report_id=_all', async () => {
    http.respondWith(jsonResponse({ data: [], meta: {} }));
    await client().reports.listAll();
    expect(http.lastUrl()).toContain('report_id=_all');
    expect(http.lastUrl()).toContain('/api/maritime_reports/report');
  });
});

describe('auth transport', () => {
  /** Every public method, with a response shape it accepts. */
  const methods: Array<[string, (c: Datalastic) => Promise<unknown>, unknown]> = [
    ['stat', (c) => c.stat(), {}],
    ['vessels.get', (c) => c.vessels.get({ mmsi: '123' }), {}],
    ['vessels.pro', (c) => c.vessels.pro({ imo: '9999999' }), {}],
    ['vessels.bulk', (c) => c.vessels.bulk({ mmsi: ['1', '2'] }), { total: 0, vessels: [] }],
    [
      'vessels.inRadius',
      (c) => c.vessels.inRadius({ lat: 1, lon: 2, radius: 5 }),
      { point: { lat: 1, lon: 2, radius: 5 }, total: 0, vessels: [] },
    ],
    ['vessels.history', (c) => c.vessels.history({ uuid: 'v1' }), { positions: [] }],
    ['vessels.info', (c) => c.vessels.info({ imo: '9999999' }), {}],
    ['vessels.find', (c) => c.vessels.find({ name: 'EVER' }), []],
    ['vessels.estimated', (c) => c.vessels.estimated({ uuid: 'v1' }), {}],
    ['ports.find', (c) => c.ports.find({ name: 'Rotterdam' }), []],
    ['ports.get', (c) => c.ports.get({ unlocode: 'NLRTM' }), { terminals: [] }],
    [
      'routes.calculate',
      (c) => c.routes.calculate({ port_unlocode_from: 'NLRTM', port_unlocode_to: 'SGSIN' }),
      { from: {}, route: {}, to: {} },
    ],
    ['intel.dryDock', (c) => c.intel.dryDock({ imo: '9999999' }), []],
    ['intel.casualties', (c) => c.intel.casualties({ imo: '9999999' }), []],
    ['intel.inspections', (c) => c.intel.inspections({ imo: '9999999' }), []],
    ['intel.spd', (c) => c.intel.spd({ imo: '9999999' }), []],
    ['intel.ownership', (c) => c.intel.ownership({ imo: '9999999' }), []],
    ['intel.classSociety', (c) => c.intel.classSociety({ imo: '9999999' }), []],
    ['intel.engine', (c) => c.intel.engine({ imo: '9999999' }), []],
    ['intel.companies', (c) => c.intel.companies({ company_imo: '1234567' }), []],
    ['reports.submit', (c) => c.reports.submit('port_calls', { imo: '9999999' }), {}],
    ['reports.get', (c) => c.reports.get('r1'), {}],
    ['reports.listAll', (c) => c.reports.listAll(), []],
  ];

  test.each(methods)(
    '%s sends the key only as the x-api-key header',
    async (_name, invoke, data) => {
      http.respondWith(jsonResponse({ data, meta: {} }));
      await invoke(client());

      expect(http.callCount()).toBe(1);
      expect(http.lastHeaders()['x-api-key']).toBe(API_KEY);

      const url = new URL(http.lastUrl());
      for (const key of url.searchParams.keys()) {
        expect(key).not.toMatch(/^x?[-_]?api[-_]?key$/i);
      }
      expect(url.search).not.toContain(API_KEY);

      const body = http.lastInit().body;
      if (body !== undefined && body !== null) {
        const parsed = JSON.parse(String(body)) as Record<string, unknown>;
        for (const key of Object.keys(parsed)) {
          expect(key).not.toMatch(/^x?[-_]?api[-_]?key$/i);
        }
        expect(String(body)).not.toContain(API_KEY);
      }
    },
  );
});
