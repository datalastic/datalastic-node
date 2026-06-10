/**
 * TypeScript interfaces describing the Datalastic Maritime API response shapes.
 *
 * These types model the `data` payload of each endpoint after the SDK has
 * unwrapped the `{ data, meta }` envelope.
 */

export interface Vessel {
  uuid: string;
  name: string;
  mmsi: string;
  imo: string;
  eni: string | null;
  country_iso: string;
  type: string;
  type_specific: string;
  lat: number;
  lon: number;
  speed: number;
  course: number;
  navigation_status: string | null;
  heading: number;
  destination: string;
  last_position_epoch: number;
  last_position_UTC: string;
}

export interface VesselPro extends Vessel {
  current_draught: number;
  dest_port: string;
  dest_port_unlocode: string;
  dep_port: string;
  dep_port_unlocode: string;
  atd_epoch: number;
  atd_UTC: string;
  eta_epoch: number;
  eta_UTC: string;
}

export interface VesselEstimated extends VesselPro {
  estimated_position: { lat: number; lon: number };
}

export interface VesselBulkResult {
  total: number;
  vessels: Vessel[];
}

export interface VesselInRadiusResult {
  point: { lat: number; lon: number; radius: number };
  total: number;
  vessels: Array<Vessel & { distance: number }>;
}

export interface VesselFindResult {
  vessels: VesselInfo[];
  next?: string;
}

export interface VesselHistory {
  uuid: string;
  name: string;
  mmsi: string;
  imo: string;
  eni: string | null;
  country_iso: string;
  type: string;
  type_specific: string;
  positions: Array<{
    lat: number;
    lon: number;
    speed: number;
    course: number;
    heading: number;
    destination: string;
    last_position_epoch: number;
    last_position_UTC: string;
  }>;
}

export interface VesselInfo {
  uuid: string;
  name: string;
  name_ais: string;
  mmsi: string;
  imo: string;
  eni: string | null;
  country_iso: string;
  country_name: string;
  callsign: string;
  type: string;
  type_specific: string;
  gross_tonnage: number;
  deadweight: number;
  teu: string | null;
  liquid_gas: number | null;
  length: number;
  breadth: number;
  draught_avg: number | null;
  draught_max: number | null;
  speed_avg: number | null;
  speed_max: number | null;
  year_built: string;
  is_navaid: boolean;
  home_port: string;
}

export interface Port {
  uuid: string;
  port_name: string;
  country_iso: string;
  country_name: string;
  unlocode: string;
  port_type: string;
  lat: number;
  lon: number;
  area_lvl1: string;
  area_lvl2: string;
}

export interface PortDetail extends Port {
  terminals: Array<{
    terminal_code: string;
    terminal_name: string;
    company_name: string;
    lat: number;
    lon: number;
    url: string;
    address: string;
  }>;
}

export interface SeaRoute {
  from: { type: string; geometry: object; properties: object };
  route: { type: string; geometry: object; properties: { total_dist: number } };
  to: { type: string; geometry: object; properties: object };
}

export interface ApiStat {
  user_id: string;
  key_status: string;
  requests_made: number;
  requests_remaining: number;
}

export interface Report {
  report_id: string;
  report_type: string;
  status: string;
  result_url?: string;
  created_at: string;
  updated_at?: string;
  params?: object;
}

export interface DryDockRecord {
  id: number;
  imo: string;
  vessel_name: string;
  special_survey_date: string;
  dry_dock_date: string;
  iopp_issue_date: string;
  iopp_exp_date: string;
  technical_manager: string;
  country_code: string;
  website: string;
  email: string;
  phone: string;
  address: string;
  linkedin: string | null;
  modified_at: string;
}

export interface CasualtyRecord {
  id: number;
  imo: string;
  vessel_name: string;
  casualty_date: string;
  casualty_type: string;
  casualty_details: string;
  modified_at: string;
}

export interface InspectionRecord {
  id: number;
  imo: string;
  vessel_name: string;
  vessel_type_code: string;
  flag_code: string;
  inspection_date: string;
  inspection_authority: string;
  inspection_port: string;
  inspection_type: string;
  detention: string;
  ship_deficiencies: string;
  deficiency_description: string;
  technical_ism_manager: string;
  country_code: string;
  website: string;
  email: string;
  phone: string;
  address: string;
  company_imo: string;
  modified_at: string;
}

export interface SPDRecord {
  id: number;
  sales_report_date: string;
  imo: string;
  vessel_name: string;
  flag_name: string;
  vessel_type_code: string;
  built_year: string;
  dwt_design: number;
  gt: number;
  ldt: number;
  seller: string;
  buyer: string;
  sales_price_usd_mio: number | null;
  'sales_price_usd/ldt': number;
  destination: string;
  sales_type: string;
  dry_dock_date: string;
  special_survey_date: string;
  sales_note: string | null;
  previous_sales_record: string | null;
  modified_at: string;
}

export interface OwnershipRecord {
  id: number;
  imo: string;
  vessel_name: string;
  beneficial_owner: string;
  beneficial_owner_country: string;
  operator: string;
  operator_country: string;
  flag_name: string | null;
  vessel_type_code: string;
  built_year: string;
  buyer: string | null;
  dwt_design: number;
  class1_code: string | null;
  technical_manager: string | null;
  technical_manager_country: string | null;
  commercial_manager: string;
  commercial_manager_country: string;
  modified_at: string;
}

export interface ClassSocietyRecord {
  imo: string;
  vessel_name: string;
  vessel_type_code: string;
  flag_name: string;
  built_year: string;
  dwt_design: number;
  special_survey_date: string | null;
  dry_dock_date: string | null;
  class1_code: string;
  beneficial_owner_imo: string;
  beneficial_owner: string;
  technical_manager_imo: string;
  technical_manager: string;
  draft_design: number;
  nt: number;
  gt: number;
  loa: number;
  lbp: number;
  depth: number;
  beam_moduled: number;
  engine_builder: string;
  engine_designer: string;
  propulsion_type_code: string;
  modified_at: string;
}

export interface EngineRecord {
  imo: string;
  vessel_name: string;
  vessel_type_code: string;
  propulsion_type_code: string;
  mco: number;
  mco_unit: string;
  mco_rpm: number;
  trading_category_code: string;
  built_year: string;
  gt: number;
  engine_designation: string;
  engine_builder: string;
  engine_designer: string;
  modified_at: string;
}

export interface CompanyRecord {
  id: number;
  short_name: string;
  long_name: string;
  company_type: string;
  country_code: string;
  company_imo: string;
  website: string;
  company_status: string;
  email: string;
  phone: string;
  address: string;
  linkedin: string | null;
  parent_company_imo: string | null;
  parent_company_name: string | null;
  modified_at: string;
}
