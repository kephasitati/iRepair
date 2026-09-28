import type { JobStatus } from "./state-machine";
import type { WalkInGate } from "./walk-in";

/** The repair workflow as staff see it: one stage per step of the job, in order. */
export const STAFF_STAGES: { key: string; label: string; statuses: JobStatus[] }[] = [
  {
    key: "pickup",
    label: "Pickup",
    statuses: ["draft", "pickup_fee_pending", "pickup_requested", "rider_en_route_to_customer", "pickup_failed", "picked_up", "in_transit_to_shop"],
  },
  { key: "intake", label: "Intake", statuses: ["received_at_shop", "intake_ack_pending"] },
  { key: "diagnose", label: "Diagnose", statuses: ["diagnosing"] },
  { key: "quote", label: "Quote", statuses: ["quote_sent", "quote_negotiating", "quote_expired", "quote_declined"] },
  { key: "deposit", label: "Deposit", statuses: ["deposit_pending"] },
  { key: "repair", label: "Repair", statuses: ["in_repair"] },
  { key: "payment", label: "Payment", statuses: ["repair_complete", "final_payment_pending"] },
  {
    key: "dispatch",
    label: "Dispatch",
    statuses: ["dispatch_pending", "return_requested", "rider_en_route_to_shop", "ready_for_collection", "return_fee_pending", "return_failed"],
  },
  { key: "delivery", label: "Delivery", statuses: ["collected_from_shop", "in_transit_to_customer", "delivered"] },
  { key: "done", label: "Done", statuses: ["closed", "declined_returned", "cancelled"] },
];

export function stageIndex(status: JobStatus): number {
  return STAFF_STAGES.findIndex((s) => s.statuses.includes(status));
}

export type NextStep = { who: "shop" | "admin" | "customer" | "courier" | "none"; text: string };

/** What has to happen next for a job, and whose move it is — shown at the top of every bench job. */
export function nextStep(status: JobStatus, walkIn?: WalkInGate | null): NextStep {
  if (status === "received_at_shop" && walkIn && !walkIn.ready) {
    return walkIn.termsAccepted
      ? { who: "shop", text: "Walk-in: collect the consultation fee. Send an M-Pesa prompt, or a shop admin records cash." }
      : { who: "customer", text: "Walk-in: the customer accepts the repair terms from the SMS link, or by scanning the QR code below." };
  }
  switch (status) {
    case "draft":
      return { who: "customer", text: "Customer is still filling in the booking." };
    case "pickup_fee_pending":
      return { who: "customer", text: "Customer pays the pickup fee by M-Pesa; the rider is booked automatically." };
    case "pickup_requested":
    case "rider_en_route_to_customer":
      return { who: "courier", text: "TumaBoda rider is on the way to the customer." };
    case "pickup_failed":
      return { who: "customer", text: "Pickup failed — the customer rebooks or cancels." };
    case "picked_up":
    case "in_transit_to_shop":
      return { who: "shop", text: "Scan the rider's QR when the device arrives, then do intake." };
    case "received_at_shop":
      return { who: "shop", text: "Do intake: check the IMEI/serial, condition and accessories, take intake photos." };
    case "intake_ack_pending":
      return { who: "customer", text: "Customer reviews the intake differences before diagnosis continues." };
    case "diagnosing":
      return { who: "shop", text: "Diagnose, then build and send the quote." };
    case "quote_sent":
      return { who: "customer", text: "Customer accepts, counters or declines the quote. Accepting takes them straight to the deposit." };
    case "quote_negotiating":
      return { who: "shop", text: "Customer made a counter-offer — accept it, or reply and revise the quote." };
    case "quote_expired":
      return { who: "shop", text: "Quote expired — reissue it, or it will be declined automatically." };
    case "quote_declined":
      return { who: "none", text: "Quote declined — the device goes back to the customer." };
    case "deposit_pending":
      return { who: "customer", text: "Customer pays the deposit by M-Pesa; the repair starts automatically when it confirms." };
    case "in_repair":
      return { who: "shop", text: "Repair, post progress updates, then complete the checklist with after-photos." };
    case "repair_complete":
      return { who: "customer", text: "Customer chooses delivery or collection; the balance (and delivery fee) is then due." };
    case "final_payment_pending":
      return { who: "customer", text: "Customer pays the balance by M-Pesa, including delivery." };
    case "dispatch_pending":
      return { who: "admin", text: "Paid. Pack the device, then request the TumaBoda rider." };
    case "return_requested":
      return { who: "courier", text: "TumaBoda is assigning a rider for the delivery." };
    case "rider_en_route_to_shop":
      return { who: "shop", text: "Rider is coming — scan their QR when you hand the device over." };
    case "ready_for_collection":
      return { who: "customer", text: "Customer collects at the counter with their collection code." };
    case "return_fee_pending":
      return { who: "customer", text: "Customer pays the return delivery fee or chooses to collect." };
    case "return_failed":
      return { who: "customer", text: "Delivery failed — the customer rebooks delivery or chooses collection." };
    case "collected_from_shop":
    case "in_transit_to_customer":
      return { who: "courier", text: "Rider is delivering; the customer scans the rider's QR on receipt." };
    case "delivered":
      return { who: "customer", text: "Customer confirms and rates the repair." };
    default:
      return { who: "none", text: "Nothing left to do." };
  }
}

export const WHO_LABEL: Record<NextStep["who"], string> = { shop: "Your move", admin: "Admin", customer: "Customer", courier: "TumaBoda", none: "" };
