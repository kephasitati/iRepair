/**
 * The job lifecycle state machine. This file is the authoring source of truth:
 * `npm run gen:state-machine` turns it into db/migrations/0002_state_machine.sql, which the
 * database uses to reject illegal transitions. tests/unit/state-machine.test.ts fails if they drift.
 */

export const JOB_STATUSES = [
  'draft',
  'pickup_fee_pending',
  'pickup_requested',
  'rider_en_route_to_customer',
  'pickup_failed',
  'picked_up',
  'in_transit_to_shop',
  'received_at_shop',
  'intake_ack_pending',
  'diagnosing',
  'quote_sent',
  'quote_negotiating',
  'quote_expired',
  'quote_declined',
  'return_fee_pending',
  'deposit_pending',
  'in_repair',
  'repair_complete',
  'final_payment_pending',
  'dispatch_pending',
  'ready_for_collection',
  'return_requested',
  'rider_en_route_to_shop',
  'collected_from_shop',
  'in_transit_to_customer',
  'return_failed',
  'delivered',
  'closed',
  'cancelled',
  'declined_returned',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const ACTOR_KINDS = ['customer', 'technician', 'shop_admin', 'platform_admin', 'system', 'provider'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

/** Actors that may be listed on an edge. shop_admin inherits technician; platform_admin (support mode) inherits shop_admin. */
type EdgeActor = 'customer' | 'technician' | 'shop_admin' | 'system' | 'provider';

const C: EdgeActor = 'customer';
const T: EdgeActor = 'technician';
const A: EdgeActor = 'shop_admin';
const S: EdgeActor = 'system';
const P: EdgeActor = 'provider';

export const TRANSITIONS: Record<JobStatus, Partial<Record<JobStatus, EdgeActor[]>>> = {
  draft: { pickup_fee_pending: [C], cancelled: [C, A] },
  pickup_fee_pending: { pickup_requested: [S], draft: [C], cancelled: [C, A] },
  // The customer may confirm the rider's arrival by scanning before the courier reports "en route".
  pickup_requested: { rider_en_route_to_customer: [P, S, C], pickup_failed: [P, S, A], cancelled: [C, A] },
  rider_en_route_to_customer: { picked_up: [C, P, S, A], pickup_failed: [P, S, A], cancelled: [C, A] },
  pickup_failed: { pickup_requested: [C, A], cancelled: [C, A] },
  picked_up: { in_transit_to_shop: [P, S], received_at_shop: [T] },
  in_transit_to_shop: { received_at_shop: [T] },
  received_at_shop: { diagnosing: [T], intake_ack_pending: [T], return_fee_pending: [A] },
  intake_ack_pending: { diagnosing: [C], return_fee_pending: [C, A] },
  diagnosing: { quote_sent: [T], return_fee_pending: [C, A] },
  quote_sent: { quote_negotiating: [C], deposit_pending: [C], quote_declined: [C, A], quote_expired: [S] },
  quote_negotiating: { quote_sent: [T], deposit_pending: [C, T], quote_declined: [C, A], quote_expired: [S] },
  quote_expired: { quote_sent: [T], quote_declined: [C, S, A] },
  quote_declined: { return_fee_pending: [S] },
  return_fee_pending: { return_requested: [S], ready_for_collection: [C, A] },
  deposit_pending: { in_repair: [S], quote_declined: [C, A] },
  in_repair: { repair_complete: [T], return_fee_pending: [A] },
  repair_complete: { final_payment_pending: [C, A] },
  final_payment_pending: { dispatch_pending: [S], repair_complete: [C, A] },
  dispatch_pending: { return_requested: [S], ready_for_collection: [S] },
  // The technician may confirm the rider's arrival at the counter by scanning before the courier reports it.
  return_requested: { rider_en_route_to_shop: [P, S, T], return_failed: [P, S, A] },
  rider_en_route_to_shop: { collected_from_shop: [T], return_failed: [P, S, A] },
  collected_from_shop: { in_transit_to_customer: [P, S], delivered: [C, P, S, A], return_failed: [P, S, A] },
  in_transit_to_customer: { delivered: [C, P, S, A], return_failed: [P, S, A] },
  return_failed: { return_requested: [C, A], ready_for_collection: [C, A] },
  ready_for_collection: { closed: [T], declined_returned: [T], cancelled: [T] },
  delivered: { closed: [C, S, A], declined_returned: [C, S, A], cancelled: [C, S, A] },
  closed: {},
  cancelled: {},
  declined_returned: {},
};

export const TERMINAL_STATUSES: readonly JobStatus[] = ['closed', 'cancelled', 'declined_returned'];

/** States in which the device is physically at the shop (drives "unclaimed device" and shop_admin cancel rules). */
export const DEVICE_AT_SHOP: readonly JobStatus[] = [
  'received_at_shop',
  'intake_ack_pending',
  'diagnosing',
  'quote_sent',
  'quote_negotiating',
  'quote_expired',
  'quote_declined',
  'return_fee_pending',
  'deposit_pending',
  'in_repair',
  'repair_complete',
  'final_payment_pending',
  'dispatch_pending',
  'ready_for_collection',
  'return_requested',
  'rider_en_route_to_shop',
  'return_failed',
];

/** Which actor kinds an edge actually accepts after role inheritance. */
export function expandActors(actors: readonly EdgeActor[]): ActorKind[] {
  const out = new Set<ActorKind>(actors);
  if (out.has('technician')) out.add('shop_admin');
  if (out.has('shop_admin')) out.add('platform_admin');
  return ACTOR_KINDS.filter((a) => out.has(a));
}

export function allowedActors(from: JobStatus, to: JobStatus): ActorKind[] {
  const edge = TRANSITIONS[from]?.[to];
  return edge ? expandActors(edge) : [];
}

export function canTransition(from: JobStatus, to: JobStatus, actor: ActorKind): boolean {
  return allowedActors(from, to).includes(actor);
}

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: JobStatus,
    public readonly to: JobStatus,
    public readonly actor: ActorKind,
  ) {
    super(`Illegal job transition ${from} -> ${to} by ${actor}`);
    this.name = 'IllegalTransitionError';
  }
}

export function assertTransition(from: JobStatus, to: JobStatus, actor: ActorKind): void {
  if (!canTransition(from, to, actor)) throw new IllegalTransitionError(from, to, actor);
}

export function nextStatuses(from: JobStatus, actor: ActorKind): JobStatus[] {
  return (Object.keys(TRANSITIONS[from]) as JobStatus[]).filter((to) => canTransition(from, to, actor));
}

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Timers that stay alive only while the job is in one of the listed states. Leaving those states cancels them. */
export const TIMER_KINDS = [
  'quote_expiry',
  'expired_quote_autodecline',
  'deposit_reminder',
  'final_payment_reminder',
  'dropoff_reminder',
  'unclaimed_alert',
  'auto_close',
] as const;
export type TimerKind = (typeof TIMER_KINDS)[number];

export const TIMER_ALIVE_IN: Record<TimerKind, readonly JobStatus[]> = {
  quote_expiry: ['quote_sent', 'quote_negotiating'],
  expired_quote_autodecline: ['quote_expired'],
  deposit_reminder: ['deposit_pending'],
  final_payment_reminder: ['final_payment_pending'],
  dropoff_reminder: ['repair_complete'],
  unclaimed_alert: ['repair_complete', 'ready_for_collection', 'return_failed'],
  auto_close: ['delivered'],
};

/** Outcome a job must carry to enter each terminal state. `null` outcome is allowed only for `cancelled`. */
export const TERMINAL_OUTCOME: Record<'closed' | 'declined_returned' | 'cancelled', 'repaired' | 'declined' | 'cancelled'> = {
  closed: 'repaired',
  declined_returned: 'declined',
  cancelled: 'cancelled',
};

/** Technician board columns. */
export const BOARD_COLUMNS: { key: string; statuses: JobStatus[] }[] = [
  {
    key: 'incoming',
    statuses: ['pickup_fee_pending', 'pickup_requested', 'rider_en_route_to_customer', 'picked_up', 'in_transit_to_shop', 'pickup_failed'],
  },
  { key: 'at_bench', statuses: ['received_at_shop', 'diagnosing', 'in_repair'] },
  {
    key: 'awaiting_customer',
    statuses: ['intake_ack_pending', 'quote_sent', 'quote_negotiating', 'quote_expired', 'deposit_pending', 'repair_complete', 'final_payment_pending', 'return_fee_pending', 'quote_declined'],
  },
  {
    key: 'ready_to_dispatch',
    statuses: ['dispatch_pending', 'return_requested', 'rider_en_route_to_shop', 'ready_for_collection', 'return_failed'],
  },
  { key: 'out_for_delivery', statuses: ['collected_from_shop', 'in_transit_to_customer', 'delivered'] },
];

/** Customer-facing progress steps (the timeline header). */
export const CUSTOMER_STEPS: { key: string; statuses: JobStatus[] }[] = [
  { key: 'booked', statuses: ['draft', 'pickup_fee_pending'] },
  { key: 'pickup', statuses: ['pickup_requested', 'rider_en_route_to_customer', 'pickup_failed', 'picked_up', 'in_transit_to_shop'] },
  { key: 'diagnosis', statuses: ['received_at_shop', 'intake_ack_pending', 'diagnosing'] },
  { key: 'quote', statuses: ['quote_sent', 'quote_negotiating', 'quote_expired', 'deposit_pending', 'quote_declined', 'return_fee_pending'] },
  { key: 'repair', statuses: ['in_repair', 'repair_complete', 'final_payment_pending'] },
  {
    key: 'return',
    statuses: ['dispatch_pending', 'return_requested', 'rider_en_route_to_shop', 'collected_from_shop', 'in_transit_to_customer', 'return_failed', 'ready_for_collection', 'delivered'],
  },
  { key: 'done', statuses: ['closed', 'cancelled', 'declined_returned'] },
];
