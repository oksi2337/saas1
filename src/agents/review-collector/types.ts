import type { Platform } from '../../types/review';

export interface CollectTask {
  store_id: string;
  platforms: Platform[];
  priority: 'normal' | 'high';
}

export interface PlatformResult {
  platform: Platform;
  status: 'success' | 'failed' | 'blocked' | 'auth_expired' | 'skipped' | 'not_implemented';
  new_review_count: number;
  new_review_ids: string[];
  error_message?: string;
}

export interface CollectionResult {
  store_id: string;
  results: PlatformResult[];
  total_new: number;
}
