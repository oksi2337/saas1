import type { Platform } from '../../types/review';

export type OrganizerEvent =
  | StoreRegisteredEvent
  | CollectionCompletedEvent
  | AgentFailedEvent
  | ManualTriggerEvent;

export interface StoreRegisteredEvent {
  event: 'store.registered';
  store_id: string;
  store_name: string;
  owner_id: string;
  platforms: Platform[];
  plan: 'lite' | 'pro' | 'agency';
}

export interface CollectionCompletedEvent {
  event: 'collection.completed';
  store_id: string;
  new_review_count: number;
  new_review_ids: string[];
  platform_statuses: Array<{
    platform: Platform;
    status: string;
    error_message?: string;
  }>;
  collected_at: string;
}

export interface AgentFailedEvent {
  event: 'agent.failed';
  agent: string;
  store_id: string;
  attempt: number;
  error: string;
  failed_at: string;
}

export interface ManualTriggerEvent {
  event: 'manual.trigger';
  command: 'collect_now' | 'report_now';
  store_id: string | null;
  requested_by: 'owner' | 'operator';
}
