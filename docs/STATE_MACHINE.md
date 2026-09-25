# Job state machine

`lib/core/state-machine.ts` is the single source of truth: `npm run gen:state-machine` regenerates the `job_status`
enum and the `job_transitions` table in `db/migrations/0002_state_machine.sql` from it, and
`tests/unit/state-machine.test.ts` fails the build if the generated SQL ever drifts from the TypeScript. The
database itself rejects any transition not listed here (`transition_job()`, a `SECURITY DEFINER` function — see
`db/migrations/0005_functions.sql`), so this diagram is not just documentation, it's enforced twice over.

## Actors

| Letter | Actor | Notes |
| --- | --- | --- |
| C | customer | |
| T | technician | |
| A | shop_admin | inherits every edge `T` may take, plus its own |
| — | platform_admin | inherits every edge `A` may take (support-mode impersonation only) |
| S | system | the worker/outbox, or a DB trigger, acting on its own |
| P | provider | a courier webhook (TumaBoda/mock) reporting delivery status |

## Diagram

```mermaid
stateDiagram-v2
    [*] --> draft
    draft --> pickup_fee_pending: C
    draft --> cancelled: C/A

    pickup_fee_pending --> pickup_requested: S (pickup fee paid)
    pickup_fee_pending --> draft: C
    pickup_fee_pending --> cancelled: C/A

    pickup_requested --> rider_en_route_to_customer: P/S/C
    pickup_requested --> pickup_failed: P/S/A
    pickup_requested --> cancelled: C/A

    rider_en_route_to_customer --> picked_up: C/P/S/A
    rider_en_route_to_customer --> pickup_failed: P/S/A
    rider_en_route_to_customer --> cancelled: C/A

    pickup_failed --> pickup_requested: C/A
    pickup_failed --> cancelled: C/A

    picked_up --> in_transit_to_shop: P/S
    picked_up --> received_at_shop: T

    in_transit_to_shop --> received_at_shop: T

    received_at_shop --> diagnosing: T
    received_at_shop --> intake_ack_pending: T (declared vs. observed mismatch)
    received_at_shop --> return_fee_pending: A

    intake_ack_pending --> diagnosing: C (acknowledges discrepancy)
    intake_ack_pending --> return_fee_pending: C/A (rejects, wants it back)

    diagnosing --> quote_sent: T
    diagnosing --> return_fee_pending: C/A

    quote_sent --> quote_negotiating: C (counter-offer)
    quote_sent --> deposit_pending: C (accepts)
    quote_sent --> quote_declined: C/A
    quote_sent --> quote_expired: S

    quote_negotiating --> quote_sent: T (revised quote)
    quote_negotiating --> deposit_pending: C/T (agreement reached)
    quote_negotiating --> quote_declined: C/A
    quote_negotiating --> quote_expired: S

    quote_expired --> quote_sent: T (reissues)
    quote_expired --> quote_declined: C/S/A (auto-decline after N days)

    quote_declined --> return_fee_pending: S

    return_fee_pending --> return_requested: S (return fee paid)
    return_fee_pending --> ready_for_collection: C/A (customer collects in person)

    deposit_pending --> in_repair: S (deposit paid)
    deposit_pending --> quote_declined: C/A

    in_repair --> repair_complete: T
    in_repair --> return_fee_pending: A (job abandoned mid-repair)

    repair_complete --> final_payment_pending: C/A

    final_payment_pending --> dispatch_pending: S (balance paid)
    final_payment_pending --> repair_complete: C/A

    dispatch_pending --> return_requested: S
    dispatch_pending --> ready_for_collection: S

    return_requested --> rider_en_route_to_shop: P/S/T
    return_requested --> return_failed: P/S/A

    rider_en_route_to_shop --> collected_from_shop: T
    rider_en_route_to_shop --> return_failed: P/S/A

    collected_from_shop --> in_transit_to_customer: P/S
    collected_from_shop --> delivered: C/P/S/A
    collected_from_shop --> return_failed: P/S/A

    in_transit_to_customer --> delivered: C/P/S/A
    in_transit_to_customer --> return_failed: P/S/A

    return_failed --> return_requested: C/A (rebook)
    return_failed --> ready_for_collection: C/A

    ready_for_collection --> closed: T
    ready_for_collection --> declined_returned: T
    ready_for_collection --> cancelled: T

    delivered --> closed: C/S/A
    delivered --> declined_returned: C/S/A
    delivered --> cancelled: C/S/A

    closed --> [*]
    cancelled --> [*]
    declined_returned --> [*]
```

## Terminal states and their required outcome

A job entering a terminal state must carry a matching `outcome` column value (enforced in `transition_job()`):

| Terminal state | Required outcome |
| --- | --- |
| `closed` | `repaired` |
| `cancelled` | `cancelled` |
| `declined_returned` | `declined` |

## Timers

Timers are scheduled by `schedule_timer()` on entry to a state and cancelled automatically on exit (so a job that
moves on before a timer fires never gets a stale reminder). `TIMER_ALIVE_IN` (`lib/core/state-machine.ts`) is the
source of truth:

| Timer | Alive while the job is in | Effect when it fires |
| --- | --- | --- |
| `quote_expiry` | `quote_sent`, `quote_negotiating` | `quote_expired` (after `tenant_settings.quote_expiry_hours`) |
| `expired_quote_autodecline` | `quote_expired` | `quote_declined` (after `expired_quote_autodecline_days`) |
| `deposit_reminder` | `deposit_pending` | a nudge notification, no transition |
| `final_payment_reminder` | `final_payment_pending` | a nudge notification, no transition |
| `dropoff_reminder` | `repair_complete` | a nudge notification, no transition |
| `unclaimed_alert` | `repair_complete`, `ready_for_collection`, `return_failed` | alerts shop_admin (`unclaimed_after_days`) |
| `auto_close` | `delivered` | `closed` (after `tenant_settings.auto_close_hours`), outcome `repaired` |

## Board and customer-facing groupings

Two different groupings of the same 30 states drive the UI, both also defined in `lib/core/state-machine.ts` so
they can never disagree with what `canTransition()` actually allows:

- `BOARD_COLUMNS` — the technician bench board's five columns (Incoming, At bench, Awaiting customer, Ready to
  dispatch, Out for delivery).
- `CUSTOMER_STEPS` — the seven-step progress header a customer sees on their own job page (Booked, Pickup,
  Diagnosis, Quote, Repair, Return, Done), deliberately coarser than the raw state names.

## Changing the state machine

1. Edit `TRANSITIONS` (and `TIMER_ALIVE_IN` / `BOARD_COLUMNS` / `CUSTOMER_STEPS` if relevant) in
   `lib/core/state-machine.ts`.
2. `npm run gen:state-machine` to regenerate `db/migrations/0002_state_machine.sql`. Never hand-edit that file.
3. Update this diagram to match — nothing enforces the diagram staying in sync, only the SQL.
4. Add or update a test in `tests/db/transitions.test.ts` for any new edge, per the brief's "every state transition
   needs a test" rule.
