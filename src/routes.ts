/** Sea route calculation (extended API). */

import { BASE_EXT, type Client, type QueryParams } from './client.js';
import { DatalasticError } from './errors.js';
import type { SeaRoute } from './models.js';

export interface RouteCalculateParams {
  lat_from?: number;
  lon_from?: number;
  port_uuid_from?: string;
  port_unlocode_from?: string;
  lat_to?: number;
  lon_to?: number;
  port_uuid_to?: string;
  port_unlocode_to?: string;
}

export class RoutesResource {
  constructor(private readonly client: Client) {}

  /** Compute a sea route between two points or ports. */
  async calculate(params: RouteCalculateParams): Promise<SeaRoute> {
    const hasFrom =
      (params.lat_from !== undefined && params.lon_from !== undefined) ||
      params.port_uuid_from !== undefined ||
      params.port_unlocode_from !== undefined;
    const hasTo =
      (params.lat_to !== undefined && params.lon_to !== undefined) ||
      params.port_uuid_to !== undefined ||
      params.port_unlocode_to !== undefined;
    if (!hasFrom) {
      throw new DatalasticError(
        'A departure point is required: provide lat_from/lon_from, port_uuid_from, or port_unlocode_from.',
      );
    }
    if (!hasTo) {
      throw new DatalasticError(
        'An arrival point is required: provide lat_to/lon_to, port_uuid_to, or port_unlocode_to.',
      );
    }
    return this.client._get<SeaRoute>('/sea_routes', BASE_EXT, {
      ...params,
    } as QueryParams);
  }
}
