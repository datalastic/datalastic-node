/** Maritime intelligence endpoints (maritime_reports base). */

import { BASE_MR, type Datalastic, type QueryParams } from './client.js';
import { DatalasticError } from './errors.js';
import type {
  CasualtyRecord,
  ClassSocietyRecord,
  CompanyRecord,
  DryDockRecord,
  EngineRecord,
  InspectionRecord,
  OwnershipRecord,
  SPDRecord,
} from './models.js';

export interface DryDockParams {
  imo?: string;
  name?: string;
  dry_dock_from?: string;
  dry_dock_to?: string;
}

export interface CasualtyParams {
  imo?: string;
  name?: string;
  from?: string;
  to?: string;
}

export interface InspectionParams {
  imo?: string;
  name?: string;
  from?: string;
  to?: string;
}

export interface SPDParams {
  imo?: string;
  name?: string;
  from?: string;
  to?: string;
}

export interface OwnershipParams {
  imo?: string;
  name?: string;
  beneficial_owner?: string;
  operator?: string;
  technical_manager?: string;
  commercial_manager?: string;
  updated_from?: string;
}

export interface ClassSocietyParams {
  imo?: string;
  name?: string;
  fuzzy?: number;
  beneficial_owner?: string;
  beneficial_owner_imo?: string;
  technical_manager?: string;
  technical_manager_imo?: string;
  updated_from?: string;
}

export interface EngineParams {
  imo?: string;
  name?: string;
  fuzzy?: number;
  updated_from?: string;
}

export interface CompanyParams {
  company_imo?: string;
  name?: string;
  updated_from?: string;
}

function requireAtLeastOne(params: object, method: string): void {
  if (!Object.values(params).some((v) => v !== undefined)) {
    throw new DatalasticError(
      `At least one parameter is required for intel.${method}.`,
    );
  }
}

export class IntelResource {
  constructor(private readonly client: Datalastic) {}

  /** Dry dock and special survey schedule records. */
  async dryDock(params: DryDockParams): Promise<DryDockRecord[]> {
    requireAtLeastOne(params, 'dryDock');
    return this.client._get<DryDockRecord[]>('/dry_dock_dates', BASE_MR, {
      ...params,
    } as QueryParams);
  }

  /** Vessel casualty records. */
  async casualties(params: CasualtyParams): Promise<CasualtyRecord[]> {
    requireAtLeastOne(params, 'casualties');
    return this.client._get<CasualtyRecord[]>('/casualty', BASE_MR, {
      ...params,
    } as QueryParams);
  }

  /** Port state control inspection records. */
  async inspections(params: InspectionParams): Promise<InspectionRecord[]> {
    requireAtLeastOne(params, 'inspections');
    return this.client._get<InspectionRecord[]>('/inspections', BASE_MR, {
      ...params,
    } as QueryParams);
  }

  /** Sale and purchase (S&P) deal records. */
  async spd(params: SPDParams): Promise<SPDRecord[]> {
    requireAtLeastOne(params, 'spd');
    return this.client._get<SPDRecord[]>('/spd', BASE_MR, {
      ...params,
    } as QueryParams);
  }

  /** Beneficial ownership and management records. */
  async ownership(params: OwnershipParams): Promise<OwnershipRecord[]> {
    requireAtLeastOne(params, 'ownership');
    return this.client._get<OwnershipRecord[]>('/ownership', BASE_MR, {
      ...params,
    } as QueryParams);
  }

  /** Classification society records. */
  async classSociety(
    params: ClassSocietyParams,
  ): Promise<ClassSocietyRecord[]> {
    requireAtLeastOne(params, 'classSociety');
    return this.client._get<ClassSocietyRecord[]>('/class_society', BASE_MR, {
      ...params,
    } as QueryParams);
  }

  /** Engine and propulsion records. */
  async engine(params: EngineParams): Promise<EngineRecord[]> {
    requireAtLeastOne(params, 'engine');
    return this.client._get<EngineRecord[]>('/engine', BASE_MR, {
      ...params,
    } as QueryParams);
  }

  /** Company registry records. */
  async companies(params: CompanyParams): Promise<CompanyRecord[]> {
    requireAtLeastOne(params, 'companies');
    return this.client._get<CompanyRecord[]>('/companies', BASE_MR, {
      ...params,
    } as QueryParams);
  }
}
