export interface DraftRepliesTask {
  store_id: string;
  review_ids: string[];
}

export interface DraftRepliesResult {
  store_id: string;
  drafted_count: number;
  skipped_count: number;
  failed_count: number;
  reply_ids: string[];
}
