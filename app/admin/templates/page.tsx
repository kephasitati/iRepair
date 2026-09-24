import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CheckRow, Field, Section } from '@/components/fields';
import { ActionForm } from '@/components/action-form';
import { requestCtx, requireStaff } from '@/lib/auth';
import { TEMPLATE_VARIABLES } from '@/lib/core/templates';
import { withUser } from '@/lib/db';
import { saveTemplateAction } from '@/app/admin/actions';

export const metadata = { title: 'Message templates' };

export default async function TemplatesPage() {
  const { tenant } = await requireStaff('shop_admin');
  const ctx = await requestCtx();
  const rows = await withUser(ctx, (tx) => tx`
    select distinct on (event_key, audience, channel) event_key, audience, channel, title, body, critical, enabled, tenant_id is not null as custom
    from notification_templates where tenant_id = ${tenant.id} or tenant_id is null
    order by event_key, audience, channel, (tenant_id is not null) desc`);
  const events = [...new Set(rows.map((r) => r.event_key as string))];
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-lg font-semibold">Message templates</h1>
      <p className="text-sm text-muted-foreground">
        Variables: {TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(' ')}. Critical SMS ignore quiet hours ({tenant.settings.quiet_hours_start}–{tenant.settings.quiet_hours_end}).
      </p>
      {events.map((ev) => (
        <Section key={ev} title={ev}>
          <div className="space-y-4">
            {rows
              .filter((r) => r.event_key === ev)
              .map((r) => (
                <details key={`${r.audience}-${r.channel}`} className="rounded-lg border p-3">
                  <summary className="cursor-pointer text-sm">
                    <span className="font-medium">
                      {r.audience} · {r.channel}
                    </span>{' '}
                    {r.custom ? <span className="rounded bg-primary/10 px-1.5 text-xs text-primary">customised</span> : null}
                    <span className="mt-1 block truncate text-xs text-muted-foreground">{r.body}</span>
                  </summary>
                  <div className="mt-3">
                    <ActionForm action={saveTemplateAction}>
                      <input type="hidden" name="event_key" value={r.event_key} />
                      <input type="hidden" name="audience" value={r.audience} />
                      <input type="hidden" name="channel" value={r.channel} />
                      {r.channel !== 'sms' ? (
                        <Field label="Title" htmlFor={`t-${ev}-${r.audience}-${r.channel}`}>
                          <Input id={`t-${ev}-${r.audience}-${r.channel}`} name="title" defaultValue={r.title ?? ''} />
                        </Field>
                      ) : null}
                      <Field label="Message" htmlFor={`b-${ev}-${r.audience}-${r.channel}`} hint={r.channel === 'sms' ? 'Keep SMS under 160 characters where possible (one SMS segment).' : undefined}>
                        <Textarea id={`b-${ev}-${r.audience}-${r.channel}`} name="body" defaultValue={r.body} rows={3} />
                      </Field>
                      <div className="flex flex-wrap gap-2">
                        <CheckRow name="enabled" label="Enabled" defaultChecked={r.enabled} />
                        {r.channel === 'sms' ? <CheckRow name="critical" label="Critical (ignore quiet hours)" defaultChecked={r.critical} /> : null}
                        {r.custom ? <CheckRow name="reset" value="1" label="Reset to default" /> : null}
                      </div>
                    </ActionForm>
                  </div>
                </details>
              ))}
          </div>
        </Section>
      ))}
    </div>
  );
}
