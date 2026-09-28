import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { WalkInForm } from "@/components/walk-in-form";
import { requireStaff } from "@/lib/auth";
import { consultationFeeFor } from "@/lib/core/fees";
import { ID_KIND_LABEL, ID_KINDS } from "@/lib/core/identity";
import { formatKes } from "@/lib/core/money";
import { DEVICE_LABEL, enabledDevices } from "@/lib/public-data";

export const metadata = { title: "New walk-in" };

/** Counter intake for a customer who brings the device in (D-42). Technicians and shop admins alike. */
export default async function WalkInPage() {
  const { tenant } = await requireStaff();
  const types = enabledDevices(tenant);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/bench" className="rounded-md p-1 hover:bg-muted" aria-label="Back to the board">
          <ChevronLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold">New walk-in</h1>
          <p className="text-sm text-muted-foreground">
            The customer gets an SMS to accept the repair terms. Diagnosis starts once they have accepted and paid the consultation fee.
          </p>
        </div>
      </div>
      <WalkInForm
        devices={types.map((d) => ({ value: d, label: DEVICE_LABEL[d] }))}
        idKinds={ID_KINDS.map((k) => ({ value: k, label: ID_KIND_LABEL[k] }))}
        fees={Object.fromEntries(types.map((d) => [d, formatKes(consultationFeeFor(tenant.settings, d))]))}
      />
    </div>
  );
}
