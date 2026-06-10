/**
 * datalastic — Node.js SDK for the Datalastic Maritime API.
 *
 * @example
 * ```ts
 * import { Client } from 'datalastic';
 *
 * const client = new Client(process.env.DATALASTIC_API_KEY!);
 * const vessel = await client.vessels.get({ mmsi: '477882000' });
 * console.log(vessel.lat, vessel.lon);
 * ```
 */

export {
  Client,
  BASE_V0,
  BASE_EXT,
  BASE_MR,
  type ClientOptions,
  type QueryParams,
} from './client.js';

export {
  DatalasticError,
  AuthenticationError,
  InsufficientCreditsError,
  NotFoundError,
  RateLimitError,
  APIError,
} from './errors.js';

export {
  VesselsResource,
  type VesselIdentifier,
  type VesselBulkParams,
  type VesselInRadiusParams,
  type VesselHistoryParams,
  type VesselFindParams,
} from './vessels.js';

export {
  PortsResource,
  type PortFindParams,
  type PortGetParams,
} from './ports.js';

export { RoutesResource, type RouteCalculateParams } from './routes.js';

export {
  IntelResource,
  type DryDockParams,
  type CasualtyParams,
  type InspectionParams,
  type SPDParams,
  type OwnershipParams,
  type ClassSocietyParams,
  type EngineParams,
  type CompanyParams,
} from './intel.js';

export { ReportsResource } from './reports.js';

export type * from './models.js';
