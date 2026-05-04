export interface DetectCrisisTask {
  store_id: string;
  review_ids: string[];
}

export interface CrisisDetectResult {
  store_id: string;
  crisis_count: number;
  alert_ids: string[];
  alert_sent: boolean;
}
