import { requireStaff } from "@/lib/auth";
import { MenuGrid } from "@/components/staff-nav";
import { staffNavItems } from "@/components/staff-shell";
import { signOutAction } from "@/app/(auth)/actions";

export const metadata = { title: "Menu" };

/** Phone menu: every staff screen as a large tile (the bottom bar only fits the daily ones). */
export default async function MenuPage() {
  const { session, role } = await requireStaff();
  const { main, admin } = await staffNavItems(role);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Menu</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as {session.user.full_name || session.user.email} · {role === "shop_admin" ? "Shop admin" : "Technician"}
        </p>
      </div>
      <section>
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Work</h2>
        <MenuGrid items={main} />
      </section>
      {admin.length ? (
        <section>
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Shop</h2>
          <MenuGrid items={admin} />
        </section>
      ) : null}
      <form action={signOutAction}>
        <button type="submit" className="w-full rounded-xl border bg-card p-4 text-left text-sm font-medium text-destructive">
          Sign out
        </button>
      </form>
    </div>
  );
}
