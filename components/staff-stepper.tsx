import type { JobStatus } from "@/lib/core/state-machine";
import { STAFF_STAGES, stageIndex } from "@/lib/core/workflow";
import { cn } from "@/lib/utils";

/** Where a job is in the workflow, at a glance. Scrolls sideways on a phone; the current stage is kept in view. */
export function StaffStepper({ status }: { status: JobStatus }) {
  const idx = stageIndex(status);
  const offPath = ["quote_declined", "return_fee_pending", "return_failed", "pickup_failed", "cancelled", "declined_returned"].includes(status);
  return (
    <ol className="no-scrollbar -mx-3 flex snap-x gap-1 overflow-x-auto px-3 pb-1" aria-label="Workflow">
      {STAFF_STAGES.map((stage, i) => {
        const done = i < idx;
        const current = i === idx;
        return (
          <li
            key={stage.key}
            aria-current={current ? "step" : undefined}
            className={cn(
              "flex shrink-0 snap-start items-center gap-1.5 rounded-full px-3 py-1 text-xs whitespace-nowrap",
              current
                ? offPath
                  ? "bg-amber-100 font-semibold text-amber-900"
                  : "bg-primary font-semibold text-primary-foreground"
                : done
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground",
            )}
          >
            <span className="tabular-nums">{done ? "✓" : i + 1}</span>
            {stage.label}
          </li>
        );
      })}
    </ol>
  );
}
