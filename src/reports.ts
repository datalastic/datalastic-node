/** Asynchronous maritime report submission and retrieval. */

import { BASE_MR, type Client } from './client.js';
import { DatalasticError } from './errors.js';
import type { Report } from './models.js';

export class ReportsResource {
  constructor(private readonly client: Client) {}

  /** Submit a new report job. The api-key is injected into the POST body. */
  async submit(
    reportType: string,
    params: Record<string, unknown> = {},
  ): Promise<Report> {
    if (!reportType || reportType.trim() === '') {
      throw new DatalasticError('reportType is required.');
    }
    return this.client._post<Report>(
      '/report',
      { report_type: reportType, ...params },
      BASE_MR,
    );
  }

  /** Retrieve the status / result of a single report. */
  async get(reportId: string): Promise<Report> {
    if (!reportId || reportId.trim() === '') {
      throw new DatalasticError('reportId is required.');
    }
    return this.client._get<Report>('/report', BASE_MR, {
      report_id: reportId,
    });
  }

  /** List every report submitted under the configured key. */
  async listAll(): Promise<Report[]> {
    return this.client._get<Report[]>('/report', BASE_MR, {
      report_id: '_all',
    });
  }
}
