/** Port lookup endpoints. */

import type { Datalastic, QueryParams } from './client.js';
import { DatalasticError } from './errors.js';
import type { Port, PortDetail } from './models.js';

export interface PortFindParams {
  name?: string;
  uuid?: string;
  fuzzy?: number;
  port_type?: string;
  country_iso?: string;
  unlocode?: string;
  lat?: number;
  lon?: number;
  radius?: number;
}

export interface PortGetParams {
  name?: string;
  uuid?: string;
  unlocode?: string;
  lat?: number;
  lon?: number;
  radius?: number;
}

export class PortsResource {
  constructor(private readonly client: Datalastic) {}

  /** Search ports by name, location, or attributes. */
  async find(params: PortFindParams): Promise<Port[]> {
    const hasParam = Object.values(params).some((v) => v !== undefined);
    if (!hasParam) {
      throw new DatalasticError('At least one search parameter is required for port find.');
    }
    return this.client._get<Port[]>('/port_find', undefined, {
      ...params,
    } as QueryParams);
  }

  /** Detailed record for a single port, including terminals. */
  async get(params: PortGetParams): Promise<PortDetail> {
    const hasIdentifier =
      params.name !== undefined ||
      params.uuid !== undefined ||
      params.unlocode !== undefined ||
      params.lat !== undefined ||
      params.lon !== undefined;
    if (!hasIdentifier) {
      throw new DatalasticError(
        'At least one of name, uuid, unlocode, or lat/lon is required.',
      );
    }
    return this.client._get<PortDetail>('/port', undefined, {
      ...params,
    } as QueryParams);
  }
}
