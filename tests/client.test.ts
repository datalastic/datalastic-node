import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import {
  Client,
  APIError,
  AuthenticationError,
  DatalasticError,
  InsufficientCreditsError,
  NotFoundError,
  RateLimitError,
} from '../src/index.js';

const API_KEY = 'test-key';

/** Build a mock Response-like object the SDK can consume. */
function jsonResponse(
  data: unknown,
  init: { ok?: boolean; status?: number } = {},
): Response {
  const ok = init.ok ?? true;
  const status = init.status ?? 200;
  return {
    ok,
    status,
    json: async () => data,
  } as unknown as Response;
}

function errorResponse(
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {},
): Response {
  return {
    ok: false,
    status,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    json: async () => body,
  } as unknown as Response;
}

let fetchSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  fetchSpy = jest.spyOn(global, 'fetch');
});

afterEach(() => {
  fetchSpy.mockRestore();
});

/** Extract the URL string passed to the most recent fetch call. */
function lastUrl(): string {
  const call = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
  return String(call[0]);
}

function lastInit(): RequestInit | undefined {
  const call = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
  return call[1] as RequestInit | undefined;
}

describe('Client creation', () => {
  test('accepts a valid key', () => {
    expect(() => new Client(API_KEY)).not.toThrow();
  });

  test('throws on empty key', () => {
    expect(() => new Client('')).toThrow(DatalasticError);
    expect(() => new Client('   ')).toThrow(DatalasticError);
  });
});

describe('stat()', () => {
  test('maps happy path to ApiStat and sends api-key as query param', async () => {
    const stat = {
      user_id: 'u1',
      key_status: 'active',
      requests_made: 10,
      requests_remaining: 90,
    };
    fetchSpy.mockResolvedValue(jsonResponse({ data: stat, meta: {} }));

    const client = new Client(API_KEY);
    const result = await client.stat();

    expect(result).toEqual(stat);
    const url = lastUrl();
    expect(url).toContain('/api/v0/stat');
    expect(url).toContain('api-key=test-key');
  });

  test.each([
    [401, AuthenticationError],
    [402, InsufficientCreditsError],
    [403, AuthenticationError],
    [404, NotFoundError],
    [429, RateLimitError],
    [500, APIError],
  ])('maps HTTP %s to the right error', async (status, ErrCls) => {
    fetchSpy.mockResolvedValue(errorResponse(status, { message: 'boom' }));
    const client = new Client(API_KEY);
    await expect(client.stat()).rejects.toBeInstanceOf(ErrCls);
  });
});

describe('vessels.get()', () => {
  test('happy path', async () => {
    const vessel = { uuid: 'v1', name: 'Ship', mmsi: '123' };
    fetchSpy.mockResolvedValue(jsonResponse({ data: vessel, meta: {} }));
    const client = new Client(API_KEY);
    const result = await client.vessels.get({ mmsi: '123' });
    expect(result).toEqual(vessel);
    expect(lastUrl()).toContain('/vessel?');
    expect(lastUrl()).toContain('mmsi=123');
  });

  test('throws when no identifier provided', async () => {
    const client = new Client(API_KEY);
    await expect(client.vessels.get({})).rejects.toBeInstanceOf(
      DatalasticError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('vessels.pro()', () => {
  test('happy path', async () => {
    const pro = { uuid: 'v1', current_draught: 5 };
    fetchSpy.mockResolvedValue(jsonResponse({ data: pro, meta: {} }));
    const client = new Client(API_KEY);
    const result = await client.vessels.pro({ imo: '9999999' });
    expect(result).toEqual(pro);
    expect(lastUrl()).toContain('/vessel_pro?');
    expect(lastUrl()).toContain('imo=9999999');
  });
});

describe('vessels.bulk()', () => {
  test('sends repeated mmsi params', async () => {
    const data = { total: 2, vessels: [] };
    fetchSpy.mockResolvedValue(jsonResponse({ data, meta: {} }));
    const client = new Client(API_KEY);
    await client.vessels.bulk({ mmsi: ['111', '222'] });
    const url = lastUrl();
    expect(url).toContain('/vessel_bulk?');
    expect((url.match(/mmsi=/g) || []).length).toBe(2);
    expect(url).toContain('mmsi=111');
    expect(url).toContain('mmsi=222');
  });

  test('accepts a single string mmsi', async () => {
    const data = { total: 1, vessels: [] };
    fetchSpy.mockResolvedValue(jsonResponse({ data, meta: {} }));
    const client = new Client(API_KEY);
    await client.vessels.bulk({ mmsi: '111' });
    expect((lastUrl().match(/mmsi=/g) || []).length).toBe(1);
  });

  test('throws when nothing provided', async () => {
    const client = new Client(API_KEY);
    await expect(client.vessels.bulk({})).rejects.toBeInstanceOf(
      DatalasticError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('vessels.inRadius()', () => {
  test('happy path', async () => {
    const data = {
      point: { lat: 1, lon: 2, radius: 10 },
      total: 0,
      vessels: [],
    };
    fetchSpy.mockResolvedValue(jsonResponse({ data, meta: {} }));
    const client = new Client(API_KEY);
    const result = await client.vessels.inRadius({
      lat: 1,
      lon: 2,
      radius: 10,
    });
    expect(result).toEqual(data);
    expect(lastUrl()).toContain('radius=10');
  });

  test('throws when radius missing', async () => {
    const client = new Client(API_KEY);
    await expect(
      // @ts-expect-error intentionally omitting radius
      client.vessels.inRadius({ lat: 1, lon: 2 }),
    ).rejects.toBeInstanceOf(DatalasticError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('throws when no center point', async () => {
    const client = new Client(API_KEY);
    await expect(
      client.vessels.inRadius({ radius: 10 }),
    ).rejects.toBeInstanceOf(DatalasticError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('throws when lat provided without lon', async () => {
    const client = new Client(API_KEY);
    await expect(
      client.vessels.inRadius({ lat: 1, radius: 10 }),
    ).rejects.toBeInstanceOf(DatalasticError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('throws when lon provided without lat', async () => {
    const client = new Client(API_KEY);
    await expect(
      client.vessels.inRadius({ lon: 2, radius: 10 }),
    ).rejects.toBeInstanceOf(DatalasticError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('vessels.history()', () => {
  test('happy path', async () => {
    const data = { uuid: 'v1', positions: [] };
    fetchSpy.mockResolvedValue(jsonResponse({ data, meta: {} }));
    const client = new Client(API_KEY);
    const result = await client.vessels.history({ uuid: 'v1', days: 3 });
    expect(result).toEqual(data);
    const url = lastUrl();
    expect(url).toContain('/vessel_history?');
    expect(url).toContain('days=3');
  });
});

describe('vessels.info()', () => {
  test('happy path', async () => {
    const data = { uuid: 'v1', name: 'Ship', gross_tonnage: 5000 };
    fetchSpy.mockResolvedValue(jsonResponse({ data, meta: {} }));
    const client = new Client(API_KEY);
    const result = await client.vessels.info({ imo: '9999999' });
    expect(result).toEqual(data);
    expect(lastUrl()).toContain('/vessel_info?');
  });
});

describe('vessels.find()', () => {
  test('maps vesselType to type query param', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ data: [], meta: {} }));
    const client = new Client(API_KEY);
    const result = await client.vessels.find({ vesselType: 'Cargo' });
    const url = lastUrl();
    expect(url).toContain('type=Cargo');
    expect(url).not.toContain('vesselType');
    expect(result.vessels).toEqual([]);
  });

  test('happy path with name returns VesselFindResult', async () => {
    const vessels = [{ uuid: 'v1', name: 'Maersk' }];
    fetchSpy.mockResolvedValue(jsonResponse({ data: vessels, meta: { next: 'tok123' } }));
    const client = new Client(API_KEY);
    const result = await client.vessels.find({ name: 'Maersk' });
    expect(result).toEqual({ vessels, next: 'tok123' });
  });

  test('next is undefined when not in meta', async () => {
    const vessels = [{ uuid: 'v1', name: 'Maersk' }];
    fetchSpy.mockResolvedValue(jsonResponse({ data: vessels, meta: {} }));
    const client = new Client(API_KEY);
    const result = await client.vessels.find({ name: 'Maersk' });
    expect(result).toEqual({ vessels, next: undefined });
  });

  test('throws when no search param', async () => {
    const client = new Client(API_KEY);
    await expect(client.vessels.find({})).rejects.toBeInstanceOf(
      DatalasticError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('throws when only fuzzy is provided', async () => {
    const client = new Client(API_KEY);
    await expect(client.vessels.find({ fuzzy: 1 })).rejects.toBeInstanceOf(
      DatalasticError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('throws when only next is provided', async () => {
    const client = new Client(API_KEY);
    await expect(client.vessels.find({ next: 'token' })).rejects.toBeInstanceOf(
      DatalasticError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('vessels.estimated()', () => {
  test('uses the extended base URL', async () => {
    const data = { uuid: 'v1', estimated_position: { lat: 1, lon: 2 } };
    fetchSpy.mockResolvedValue(jsonResponse({ data, meta: {} }));
    const client = new Client(API_KEY);
    await client.vessels.estimated({ uuid: 'v1' });
    expect(lastUrl()).toContain('/api/ext/vessel_pro_est');
  });
});

describe('ports', () => {
  test('find() happy path', async () => {
    const data = [{ uuid: 'p1', port_name: 'Rotterdam' }];
    fetchSpy.mockResolvedValue(jsonResponse({ data, meta: {} }));
    const client = new Client(API_KEY);
    const result = await client.ports.find({ name: 'Rotterdam' });
    expect(result).toEqual(data);
    expect(lastUrl()).toContain('/port_find?');
  });

  test('find() throws when no params', async () => {
    const client = new Client(API_KEY);
    await expect(client.ports.find({})).rejects.toBeInstanceOf(DatalasticError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('get() returns PortDetail with terminals', async () => {
    const data = {
      uuid: 'p1',
      port_name: 'Rotterdam',
      terminals: [{ terminal_code: 'T1', terminal_name: 'Main' }],
    };
    fetchSpy.mockResolvedValue(jsonResponse({ data, meta: {} }));
    const client = new Client(API_KEY);
    const result = await client.ports.get({ uuid: 'p1' });
    expect(result.terminals).toHaveLength(1);
    expect(lastUrl()).toContain('/port?');
  });

  test('get() throws when no identifier', async () => {
    const client = new Client(API_KEY);
    await expect(client.ports.get({})).rejects.toBeInstanceOf(DatalasticError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('routes.calculate()', () => {
  test('uses the extended base URL', async () => {
    const data = {
      from: {},
      route: { properties: { total_dist: 100 } },
      to: {},
    };
    fetchSpy.mockResolvedValue(jsonResponse({ data, meta: {} }));
    const client = new Client(API_KEY);
    await client.routes.calculate({
      lat_from: 1,
      lon_from: 2,
      lat_to: 3,
      lon_to: 4,
    });
    expect(lastUrl()).toContain('/api/ext/sea_routes');
  });

  test('throws when no departure point', async () => {
    const client = new Client(API_KEY);
    await expect(
      client.routes.calculate({ lat_to: 3, lon_to: 4 }),
    ).rejects.toBeInstanceOf(DatalasticError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('throws when no arrival point', async () => {
    const client = new Client(API_KEY);
    await expect(
      client.routes.calculate({ lat_from: 1, lon_from: 2 }),
    ).rejects.toBeInstanceOf(DatalasticError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('throws when no params at all', async () => {
    const client = new Client(API_KEY);
    await expect(client.routes.calculate({})).rejects.toBeInstanceOf(
      DatalasticError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('accepts port identifiers instead of lat/lon', async () => {
    const data = { from: {}, route: { properties: { total_dist: 50 } }, to: {} };
    fetchSpy.mockResolvedValue(jsonResponse({ data, meta: {} }));
    const client = new Client(API_KEY);
    await client.routes.calculate({
      port_unlocode_from: 'NLRTM',
      port_unlocode_to: 'SGSIN',
    });
    expect(lastUrl()).toContain('/api/ext/sea_routes');
  });
});

describe('intel', () => {
  const mr = '/api/maritime_reports';

  test('dryDock()', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ data: [], meta: {} }));
    await new Client(API_KEY).intel.dryDock({ imo: '9999999' });
    expect(lastUrl()).toContain(`${mr}/dry_dock_dates`);
  });

  test('dryDock() throws when no params', async () => {
    await expect(new Client(API_KEY).intel.dryDock({})).rejects.toBeInstanceOf(DatalasticError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('casualties()', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ data: [], meta: {} }));
    await new Client(API_KEY).intel.casualties({ imo: '9999999' });
    expect(lastUrl()).toContain(`${mr}/casualty`);
  });

  test('casualties() throws when no params', async () => {
    await expect(new Client(API_KEY).intel.casualties({})).rejects.toBeInstanceOf(DatalasticError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('inspections()', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ data: [], meta: {} }));
    await new Client(API_KEY).intel.inspections({ imo: '9999999' });
    expect(lastUrl()).toContain(`${mr}/inspections`);
  });

  test('inspections() throws when no params', async () => {
    await expect(new Client(API_KEY).intel.inspections({})).rejects.toBeInstanceOf(DatalasticError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('spd()', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ data: [], meta: {} }));
    await new Client(API_KEY).intel.spd({ imo: '9999999' });
    expect(lastUrl()).toContain(`${mr}/spd`);
  });

  test('spd() throws when no params', async () => {
    await expect(new Client(API_KEY).intel.spd({})).rejects.toBeInstanceOf(DatalasticError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('ownership()', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ data: [], meta: {} }));
    await new Client(API_KEY).intel.ownership({ imo: '9999999' });
    expect(lastUrl()).toContain(`${mr}/ownership`);
  });

  test('ownership() throws when no params', async () => {
    await expect(new Client(API_KEY).intel.ownership({})).rejects.toBeInstanceOf(DatalasticError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('classSociety()', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ data: [], meta: {} }));
    await new Client(API_KEY).intel.classSociety({ imo: '9999999' });
    expect(lastUrl()).toContain(`${mr}/class_society`);
  });

  test('classSociety() throws when no params', async () => {
    await expect(new Client(API_KEY).intel.classSociety({})).rejects.toBeInstanceOf(DatalasticError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('engine()', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ data: [], meta: {} }));
    await new Client(API_KEY).intel.engine({ imo: '9999999' });
    expect(lastUrl()).toContain(`${mr}/engine`);
  });

  test('engine() throws when no params', async () => {
    await expect(new Client(API_KEY).intel.engine({})).rejects.toBeInstanceOf(DatalasticError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('companies()', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ data: [], meta: {} }));
    await new Client(API_KEY).intel.companies({ company_imo: '1234567' });
    expect(lastUrl()).toContain(`${mr}/companies`);
  });

  test('companies() throws when no params', async () => {
    await expect(new Client(API_KEY).intel.companies({})).rejects.toBeInstanceOf(DatalasticError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('reports', () => {
  test('submit() POSTs with api-key in body and uses maritime_reports base', async () => {
    const data = {
      report_id: 'r1',
      report_type: 'inradius_history',
      status: 'pending',
      created_at: 'now',
    };
    fetchSpy.mockResolvedValue(jsonResponse({ data, meta: {} }));
    const client = new Client(API_KEY);
    const result = await client.reports.submit('inradius_history', { imo: '9999999' });
    expect(result).toEqual(data);

    const init = lastInit();
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body['api-key']).toBe(API_KEY);
    expect(body.report_type).toBe('inradius_history');
    expect(body.imo).toBe('9999999');
    // api-key must NOT be in the URL for POST.
    expect(lastUrl()).not.toContain('api-key=');
    expect(lastUrl()).toContain('/api/maritime_reports/report');
  });

  test('submit() throws on empty reportType', async () => {
    const client = new Client(API_KEY);
    await expect(client.reports.submit('')).rejects.toBeInstanceOf(DatalasticError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('get() happy path uses maritime_reports base', async () => {
    const data = {
      report_id: 'r1',
      report_type: 'inradius_history',
      status: 'done',
      created_at: 'now',
    };
    fetchSpy.mockResolvedValue(jsonResponse({ data, meta: {} }));
    const client = new Client(API_KEY);
    const result = await client.reports.get('r1');
    expect(result).toEqual(data);
    expect(lastUrl()).toContain('report_id=r1');
    expect(lastUrl()).toContain('/api/maritime_reports/report');
  });

  test('get() throws on empty reportId', async () => {
    const client = new Client(API_KEY);
    await expect(client.reports.get('')).rejects.toBeInstanceOf(DatalasticError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('listAll() uses report_id=_all and maritime_reports base', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ data: [], meta: {} }));
    const client = new Client(API_KEY);
    await client.reports.listAll();
    expect(lastUrl()).toContain('report_id=_all');
    expect(lastUrl()).toContain('/api/maritime_reports/report');
  });
});

describe('error and response edge cases', () => {
  test('timeout / AbortError maps to APIError', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    fetchSpy.mockRejectedValue(abort);
    const client = new Client(API_KEY, { timeout: 5 });
    await expect(client.stat()).rejects.toBeInstanceOf(APIError);
  });

  test('non-JSON body maps to APIError', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);
    const client = new Client(API_KEY);
    await expect(client.stat()).rejects.toBeInstanceOf(APIError);
  });

  test('missing data key maps to APIError', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ meta: {} }));
    const client = new Client(API_KEY);
    await expect(client.stat()).rejects.toBeInstanceOf(APIError);
  });

  test('generic network failure maps to APIError', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNRESET'));
    const client = new Client(API_KEY);
    await expect(client.stat()).rejects.toBeInstanceOf(APIError);
  });

  test('RateLimitError.retryAfter is populated from Retry-After header', async () => {
    fetchSpy.mockResolvedValue(
      errorResponse(429, { message: 'slow down' }, { 'retry-after': '60' }),
    );
    const client = new Client(API_KEY);
    try {
      await client.stat();
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).retryAfter).toBe(60);
    }
  });

  test('RateLimitError.retryAfter is undefined when header is absent', async () => {
    fetchSpy.mockResolvedValue(errorResponse(429, { message: 'slow down' }));
    const client = new Client(API_KEY);
    try {
      await client.stat();
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).retryAfter).toBeUndefined();
    }
  });
});
