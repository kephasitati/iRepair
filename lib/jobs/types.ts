import type { JobStatus } from '@/lib/core/state-machine';
import type { Address } from '@/lib/providers/delivery/types';

export type DeclaredCondition = {
  powers_on?: boolean;
  screen_cracked?: boolean;
  back_cracked?: boolean;
  water_damage?: boolean;
  notes?: string;
};

export type JobRow = {
  id: string;
  tenant_id: string;
  ref: string;
  customer_user_id: string;
  assigned_tech_id: string | null;
  status: JobStatus;
  outcome: 'repaired' | 'declined' | 'cancelled' | null;
  device_id: string | null;
  device_type: import('@/lib/core/device-id').DeviceType;
  device_brand: string;
  device_model: string;
  device_colour: string | null;
  device_storage: string | null;
  fault_description: string;
  declared_condition: DeclaredCondition;
  accessories: string[];
  passcode_locked: boolean;
  passcode_shared: boolean;
  declared_value_cents: number;
  pickup_address: Address | null;
  pickup_window_start: string | null;
  pickup_window_end: string | null;
  consultation_fee_cents: number;
  pickup_fee_cents: number;
  dropoff_choice: 'pickup_address' | 'other_address' | 'collect_at_shop' | null;
  dropoff_address: Address | null;
  dropoff_window_start: string | null;
  dropoff_window_end: string | null;
  return_fee_cents: number;
  intake_discrepancy: boolean;
  not_as_expected: boolean;
  cancel_reason: string | null;
  warranty_until: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PhotoRow = {
  id: string;
  job_id: string;
  stage: 'customer_declared' | 'intake' | 'progress' | 'completion' | 'discrepancy' | 'handover';
  kind: string;
  storage_key: string;
  taken_at: string | null;
  created_at: string;
};

export type DeliveryRow = {
  id: string;
  job_id: string;
  leg: 'pickup' | 'return';
  attempt: number;
  provider: 'mock' | 'tumaboda';
  quote_ref: string | null;
  provider_delivery_id: string | null;
  tracking_url: string | null;
  fee_cost_cents: number;
  fee_charged_cents: number;
  status: 'quoted' | 'requested' | 'rider_assigned' | 'rider_en_route' | 'picked_up' | 'in_transit' | 'delivered' | 'failed' | 'cancelled';
  rider_snapshot: { name: string; phone: string; plate?: string | null } | null;
  pickup_address: Address;
  dropoff_address: Address;
  scheduled_for: string | null;
  created_at: string;
};

export type QuoteLineInput = { kind: 'part' | 'labour' | 'other' | 'discount'; part_id?: string | null; description: string; qty: number; unit_price_cents: number };

export type PaymentPurpose = 'pickup_fee' | 'deposit' | 'final_balance' | 'return_fee' | 'supplementary';

export const ACCESSORIES = ['charger', 'case', 'sim', 'sd_card', 'other'] as const;

export const PROGRESS_TEMPLATES = ['parts_ordered', 'parts_arrived', 'disassembled', 'component_replaced', 'testing', 'delay'] as const;

export const COMPLETION_TESTS = ['powers_on', 'display', 'cameras', 'audio', 'buttons', 'connectivity', 'battery', 'cosmetic'] as const;

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}
