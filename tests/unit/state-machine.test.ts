import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ACTOR_KINDS,
  BOARD_COLUMNS,
  CUSTOMER_STEPS,
  IllegalTransitionError,
  JOB_STATUSES,
  TERMINAL_STATUSES,
  TIMER_ALIVE_IN,
  TRANSITIONS,
  allowedActors,
  assertTransition,
  canTransition,
  type ActorKind,
  type JobStatus,
} from '@/lib/core/state-machine';
import { generateStateMachineSql } from '@/scripts/gen-state-machine';

const edges: [JobStatus, JobStatus][] = JOB_STATUSES.flatMap((from) => (Object.keys(TRANSITIONS[from]) as JobStatus[]).map((to) => [from, to] as [JobStatus, JobStatus]));

describe('state machine definition', () => {
  it('every status has an entry and every target is a known status', () => {
    for (const s of JOB_STATUSES) expect(TRANSITIONS[s]).toBeDefined();
    for (const [, to] of edges) expect(JOB_STATUSES).toContain(to);
  });

  it('terminal states have no outgoing edges', () => {
    for (const s of TERMINAL_STATUSES) expect(Object.keys(TRANSITIONS[s])).toHaveLength(0);
  });

  it('every non-terminal state can reach a terminal state', () => {
    for (const start of JOB_STATUSES) {
      const seen = new Set<JobStatus>([start]);
      const queue = [start];
      while (queue.length) {
        const s = queue.shift()!;
        for (const to of Object.keys(TRANSITIONS[s]) as JobStatus[]) if (!seen.has(to)) (seen.add(to), queue.push(to));
      }
      expect(TERMINAL_STATUSES.some((t) => seen.has(t)), `${start} cannot terminate`).toBe(true);
    }
  });

  it('every state except draft is reachable from draft', () => {
    const seen = new Set<JobStatus>(['draft']);
    const queue: JobStatus[] = ['draft'];
    while (queue.length) {
      const s = queue.shift()!;
      for (const to of Object.keys(TRANSITIONS[s]) as JobStatus[]) if (!seen.has(to)) (seen.add(to), queue.push(to));
    }
    expect([...seen].sort()).toEqual([...JOB_STATUSES].sort());
  });

  it('every non-draft status appears in exactly one board column or is terminal', () => {
    const inBoard = BOARD_COLUMNS.flatMap((c) => c.statuses);
    for (const s of JOB_STATUSES) {
      if (s === 'draft' || TERMINAL_STATUSES.includes(s)) continue;
      expect(inBoard.filter((x) => x === s), s).toHaveLength(1);
    }
  });

  it('every status maps to exactly one customer step', () => {
    for (const s of JOB_STATUSES) expect(CUSTOMER_STEPS.filter((st) => st.statuses.includes(s)), s).toHaveLength(1);
  });

  it('timers only live in real states', () => {
    for (const states of Object.values(TIMER_ALIVE_IN)) for (const s of states) expect(JOB_STATUSES).toContain(s);
  });
});

describe('every edge: allowed actors pass, all others throw', () => {
  for (const [from, to] of edges) {
    const allowed = allowedActors(from, to);
    it(`${from} -> ${to}`, () => {
      expect(allowed.length).toBeGreaterThan(0);
      for (const actor of ACTOR_KINDS) {
        if (allowed.includes(actor)) expect(() => assertTransition(from, to, actor)).not.toThrow();
        else expect(() => assertTransition(from, to, actor)).toThrow(IllegalTransitionError);
      }
    });
  }
});

describe('illegal transitions throw for every actor', () => {
  it('all non-edges are rejected', () => {
    let checked = 0;
    for (const from of JOB_STATUSES) {
      for (const to of JOB_STATUSES) {
        if (TRANSITIONS[from][to]) continue;
        for (const actor of ACTOR_KINDS) {
          expect(canTransition(from, to, actor)).toBe(false);
          expect(() => assertTransition(from, to, actor)).toThrow(IllegalTransitionError);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(4000);
  });
});

describe('role inheritance and key business rules', () => {
  const can = (f: JobStatus, t: JobStatus, a: ActorKind) => canTransition(f, t, a);

  it('shop_admin can do what technicians do; platform_admin (support mode) can do what shop_admin does', () => {
    for (const [from, to] of edges) {
      if (can(from, to, 'technician')) expect(can(from, to, 'shop_admin')).toBe(true);
      if (can(from, to, 'shop_admin')) expect(can(from, to, 'platform_admin')).toBe(true);
    }
  });

  it('only the system confirms payments', () => {
    expect(allowedActors('pickup_fee_pending', 'pickup_requested')).toEqual(['system']);
    expect(allowedActors('deposit_pending', 'in_repair')).toEqual(['system']);
    expect(allowedActors('final_payment_pending', 'dispatch_pending')).toEqual(['system']);
    expect(allowedActors('return_fee_pending', 'return_requested')).toEqual(['system']);
  });

  it('customer can cancel for free only before pickup is requested, and may cancel a booked pickup', () => {
    expect(can('draft', 'cancelled', 'customer')).toBe(true);
    expect(can('pickup_fee_pending', 'cancelled', 'customer')).toBe(true);
    expect(can('pickup_requested', 'cancelled', 'customer')).toBe(true);
    expect(can('diagnosing', 'cancelled', 'customer')).toBe(false);
    expect(can('diagnosing', 'return_fee_pending', 'customer')).toBe(true);
  });

  it('customer cannot self-cancel once the deposit is paid (Q-17)', () => {
    expect(nextFor('in_repair', 'customer')).toEqual([]);
  });

  it('discrepancy must be acknowledged by the customer before diagnosis', () => {
    expect(can('intake_ack_pending', 'diagnosing', 'technician')).toBe(false);
    expect(can('intake_ack_pending', 'diagnosing', 'customer')).toBe(true);
  });

  it('technician cannot skip the intake step', () => {
    expect(can('received_at_shop', 'quote_sent', 'technician')).toBe(false);
    expect(can('in_transit_to_shop', 'diagnosing', 'technician')).toBe(false);
  });

  it('customers can never mark a repair complete or move money states', () => {
    expect(can('in_repair', 'repair_complete', 'customer')).toBe(false);
    expect(can('deposit_pending', 'in_repair', 'customer')).toBe(false);
  });
});

function nextFor(from: JobStatus, actor: ActorKind) {
  return (Object.keys(TRANSITIONS[from]) as JobStatus[]).filter((to) => canTransition(from, to, actor));
}

describe('database seed stays in sync with the TS map', () => {
  it('db/migrations/0002_state_machine.sql matches the generator output', () => {
    const file = readFileSync(path.join(__dirname, '../../db/migrations/0002_state_machine.sql'), 'utf8');
    expect(file).toBe(generateStateMachineSql());
  });
});
