export interface GenerateReportTask {
  store_id: string | null;  // null이면 활성 매장 전체
  report_type: 'weekly' | 'monthly';
  period_start: string;  // "YYYY-MM-DD"
  period_end: string;
}

export interface ReportResult {
  store_id: string;
  report_id: string | null;
  status: 'sent' | 'failed' | 'skipped';
  excel_file_url: string | null;
  error?: string;
}

export interface GenerateReportResult {
  report_type: 'weekly' | 'monthly';
  period_start: string;
  period_end: string;
  results: ReportResult[];
}
