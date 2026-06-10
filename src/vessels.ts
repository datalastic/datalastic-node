/** Vessel tracking and lookup endpoints. */

import { BASE_EXT, type Client, type QueryParams } from './client.js';
import { DatalasticError } from './errors.js';
import type {
  Vessel,
  VesselBulkResult,
  VesselEstimated,
  VesselHistory,
  VesselInfo,
  VesselInRadiusResult,
  VesselPro,
} from './models.js';

/** Identify a single vessel by one of its identifiers. */
export interface VesselIdentifier {
  uuid?: string;
  mmsi?: string;
  imo?: string;
}

export interface VesselBulkParams {
  mmsi?: string | string[];
  imo?: string | string[];
  uuid?: string | string[];
}

export interface VesselInRadiusParams {
  lat?: number;
  lon?: number;
  port_uuid?: string;
  port_unlocode?: string;
  uuid?: string;
  mmsi?: string;
  imo?: string;
  radius: number;
  type?: string;
  type_specific?: string;
  exclude?: string;
  nav_status?: number;
  next?: string;
}

export interface VesselHistoryParams extends VesselIdentifier {
  days?: number;
  from?: string;
  to?: string;
}

export interface VesselFindParams {
  name?: string;
  fuzzy?: number;
  vesselType?: string;
  type_specific?: string;
  country_iso?: string;
  gross_tonnage_min?: number;
  gross_tonnage_max?: number;
  deadweight_min?: number;
  deadweight_max?: number;
  length_min?: number;
  length_max?: number;
  breadth_min?: number;
  breadth_max?: number;
  year_built_min?: number;
  year_built_max?: number;
  next?: string;
}

function requireIdentifier(params: VesselIdentifier): void {
  if (!params.uuid && !params.mmsi && !params.imo) {
    throw new DatalasticError(
      'At least one of uuid, mmsi, or imo is required.',
    );
  }
}

/** Normalize a string | string[] value into an array (or undefined). */
function toArray(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

export class VesselsResource {
  constructor(private readonly client: Client) {}

  /** Real-time position for a single vessel. */
  async get(params: VesselIdentifier): Promise<Vessel> {
    requireIdentifier(params);
    return this.client._get<Vessel>('/vessel', undefined, { ...params });
  }

  /** Extended real-time position including voyage details. */
  async pro(params: VesselIdentifier): Promise<VesselPro> {
    requireIdentifier(params);
    return this.client._get<VesselPro>('/vessel_pro', undefined, { ...params });
  }

  /** Positions for multiple vessels in a single call. */
  async bulk(params: VesselBulkParams): Promise<VesselBulkResult> {
    const mmsi = toArray(params.mmsi);
    const imo = toArray(params.imo);
    const uuid = toArray(params.uuid);

    if (!mmsi && !imo && !uuid) {
      throw new DatalasticError(
        'At least one of mmsi, imo, or uuid is required for bulk lookup.',
      );
    }

    const query: QueryParams = {};
    if (mmsi) query.mmsi = mmsi;
    if (imo) query.imo = imo;
    if (uuid) query.uuid = uuid;

    return this.client._get<VesselBulkResult>(
      '/vessel_bulk',
      undefined,
      query,
    );
  }

  /** Vessels within a radius of a point, port, or vessel. */
  async inRadius(
    params: VesselInRadiusParams,
  ): Promise<VesselInRadiusResult> {
    if (params.radius === undefined || params.radius === null) {
      throw new DatalasticError('radius is required.');
    }
    if (params.lat !== undefined && params.lon === undefined) {
      throw new DatalasticError('lon is required when lat is provided.');
    }
    if (params.lon !== undefined && params.lat === undefined) {
      throw new DatalasticError('lat is required when lon is provided.');
    }
    const hasCenter =
      (params.lat !== undefined && params.lon !== undefined) ||
      params.port_uuid !== undefined ||
      params.port_unlocode !== undefined ||
      params.uuid !== undefined ||
      params.mmsi !== undefined ||
      params.imo !== undefined;
    if (!hasCenter) {
      throw new DatalasticError(
        'A center point is required: provide lat/lon, a port, or a vessel identifier.',
      );
    }
    return this.client._get<VesselInRadiusResult>(
      '/vessel_inradius',
      undefined,
      { ...params },
    );
  }

  /** Historical track for a single vessel. */
  async history(params: VesselHistoryParams): Promise<VesselHistory> {
    requireIdentifier(params);
    return this.client._get<VesselHistory>('/vessel_history', undefined, {
      ...params,
    });
  }

  /** Static particulars for a single vessel. */
  async info(params: VesselIdentifier): Promise<VesselInfo> {
    requireIdentifier(params);
    return this.client._get<VesselInfo>('/vessel_info', undefined, {
      ...params,
    });
  }

  /** Search the vessel database by particulars. */
  async find(params: VesselFindParams): Promise<VesselInfo[]> {
    const { vesselType, fuzzy, next, ...searchable } = params;
    const hasSearch =
      vesselType !== undefined ||
      Object.values(searchable).some((v) => v !== undefined);
    if (!hasSearch) {
      throw new DatalasticError(
        'At least one search parameter is required for vessel find (fuzzy and next alone do not qualify).',
      );
    }
    const query: QueryParams = { ...searchable };
    if (fuzzy !== undefined) query.fuzzy = fuzzy;
    if (next !== undefined) query.next = next;
    // vesselType maps to the `type` query parameter.
    if (vesselType !== undefined) query.type = vesselType;

    return this.client._get<VesselInfo[]>('/vessel_find', undefined, query);
  }

  /** Pro position with an estimated dead-reckoned position (extended API). */
  async estimated(params: VesselIdentifier): Promise<VesselEstimated> {
    requireIdentifier(params);
    return this.client._get<VesselEstimated>('/vessel_pro_est', BASE_EXT, {
      ...params,
    });
  }
}
