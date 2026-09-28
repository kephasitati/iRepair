import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth-card";
import { PhoneLoginForm } from "@/components/auth-forms";
import { getSession } from "@/lib/auth";
import { safeRedirectPath } from "@/lib/core/redirect";
import { requireTenant } from "@/lib/tenant";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; phone?: string }> }) {
  const [tenant, session, sp, t] = await Promise.all([requireTenant(), getSession(), searchParams, getTranslations("auth")]);
  if (session) redirect(safeRedirectPath(sp.next, "/jobs"));
  return (
    <AuthCard brand={tenant.branding.display_name} title={t("customerLoginTitle")} subtitle={t("signInWithPhone")}>
      <PhoneLoginForm next={sp.next} defaultPhone={sp.phone} />
    </AuthCard>
  );
}
