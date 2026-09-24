import 'server-only';
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { formatKes } from '@/lib/core/money';
import { formatDate } from '@/lib/core/time';
import type { InvoiceLine } from '@/lib/core/money';

/** Tenant-branded tax invoice / proforma. KRA eTIMS fields are left as a hook (docs/PLAN.md Phase 3). */

export type InvoiceData = {
  number: string | null;
  status: 'proforma' | 'issued' | 'void';
  issued_at: string | null;
  created_at: string;
  lines: InvoiceLine[];
  subtotal_cents: number;
  vat_cents: number;
  vat_rate_bp: number;
  rounding_cents: number;
  total_cents: number;
  paid_cents: number;
  balance_cents: number;
  customer_snapshot: { name: string; phone: string | null; email: string | null; address?: { formatted?: string } | null };
  tenant_snapshot: { name: string; kra_pin: string | null; vat_registered: boolean; address: string; phone: string; email?: string | null; primary_hex: string };
  job_ref: string;
  device: string;
  payments: { receipt: string | null; amount_cents: number; purpose: string; confirmed_at: string }[];
  warranty_until?: string | null;
  etims?: { status: string; cu_invoice_number?: string; qr?: string } | null;
};

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: 'Helvetica', color: '#111' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  shop: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
  muted: { color: '#555' },
  title: { fontSize: 18, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#ddd', paddingVertical: 4 },
  th: { fontFamily: 'Helvetica-Bold', backgroundColor: '#f3f4f6' },
  cDesc: { flex: 5 },
  cQty: { flex: 1, textAlign: 'right' },
  cUnit: { flex: 2, textAlign: 'right' },
  cTotal: { flex: 2, textAlign: 'right' },
  totals: { marginTop: 8, alignItems: 'flex-end' },
  totalRow: { flexDirection: 'row', width: 240, justifyContent: 'space-between', paddingVertical: 2 },
  grand: { fontFamily: 'Helvetica-Bold', fontSize: 12, borderTopWidth: 1, borderTopColor: '#111', paddingTop: 4, marginTop: 2 },
  section: { marginTop: 14 },
  h: { fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  footer: { position: 'absolute', bottom: 24, left: 36, right: 36, fontSize: 8, color: '#666', textAlign: 'center' },
});

export function InvoiceDocument({ inv }: { inv: InvoiceData }) {
  const t = inv.tenant_snapshot;
  const c = inv.customer_snapshot;
  const isTax = inv.status === 'issued' && t.vat_registered;
  const title = inv.status === 'proforma' ? 'PROFORMA INVOICE' : isTax ? 'TAX INVOICE' : 'INVOICE';
  return (
    <Document title={`${title} ${inv.number ?? inv.job_ref}`} author={t.name}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={[s.shop, { color: t.primary_hex }]}>{t.name}</Text>
            <Text style={s.muted}>{t.address}</Text>
            <Text style={s.muted}>{t.phone}{t.email ? `  ·  ${t.email}` : ''}</Text>
            {t.kra_pin ? <Text style={s.muted}>KRA PIN: {t.kra_pin}</Text> : null}
          </View>
          <View>
            <Text style={s.title}>{title}</Text>
            {inv.number ? <Text style={{ textAlign: 'right' }}>No. {inv.number}</Text> : null}
            <Text style={{ textAlign: 'right' }}>Date: {formatDate(inv.issued_at ?? inv.created_at)}</Text>
            <Text style={{ textAlign: 'right' }}>Job: {inv.job_ref}</Text>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.h}>Bill to</Text>
          <Text>{c.name}</Text>
          {c.phone ? <Text style={s.muted}>{c.phone}</Text> : null}
          {c.address?.formatted ? <Text style={s.muted}>{c.address.formatted}</Text> : null}
          <Text style={{ marginTop: 4 }}>Device: {inv.device}</Text>
        </View>

        <View style={[s.section]}>
          <View style={[s.row, s.th]}>
            <Text style={s.cDesc}>Description</Text>
            <Text style={s.cQty}>Qty</Text>
            <Text style={s.cUnit}>Unit</Text>
            <Text style={s.cTotal}>Total</Text>
          </View>
          {inv.lines.map((l, i) => (
            <View style={s.row} key={i}>
              <Text style={s.cDesc}>{l.description}{!l.vatable && t.vat_registered ? ' *' : ''}</Text>
              <Text style={s.cQty}>{l.qty}</Text>
              <Text style={s.cUnit}>{formatKes(l.unitPriceCents, { withSymbol: false })}</Text>
              <Text style={s.cTotal}>{formatKes(l.totalCents, { withSymbol: false })}</Text>
            </View>
          ))}
        </View>

        <View style={s.totals}>
          <View style={s.totalRow}><Text>Subtotal (excl. VAT)</Text><Text>{formatKes(inv.subtotal_cents)}</Text></View>
          <View style={s.totalRow}><Text>VAT {inv.vat_rate_bp / 100}%</Text><Text>{formatKes(inv.vat_cents)}</Text></View>
          {inv.rounding_cents ? <View style={s.totalRow}><Text>Rounding</Text><Text>{formatKes(inv.rounding_cents)}</Text></View> : null}
          <View style={[s.totalRow, s.grand]}><Text>Total</Text><Text>{formatKes(inv.total_cents)}</Text></View>
          <View style={s.totalRow}><Text>Paid</Text><Text>{formatKes(inv.paid_cents)}</Text></View>
          <View style={[s.totalRow, { fontFamily: 'Helvetica-Bold' }]}><Text>Balance</Text><Text>{formatKes(inv.balance_cents)}</Text></View>
        </View>

        {inv.payments.length ? (
          <View style={s.section}>
            <Text style={s.h}>Payments</Text>
            {inv.payments.map((p, i) => (
              <Text key={i}>{formatDate(p.confirmed_at)} · {p.purpose.replace('_', ' ')} · {formatKes(p.amount_cents)} · M-Pesa {p.receipt ?? '-'}</Text>
            ))}
          </View>
        ) : null}

        {inv.warranty_until ? <Text style={[s.section, s.muted]}>Repair warranty until {formatDate(inv.warranty_until)}.</Text> : null}
        {t.vat_registered ? <Text style={[s.section, s.muted]}>* Courier charges are passed through at cost, inclusive of the courier&apos;s VAT, and are outside this invoice&apos;s VAT base.</Text> : null}
        {inv.etims?.cu_invoice_number ? <Text style={[s.section]}>KRA CU Invoice No: {inv.etims.cu_invoice_number}</Text> : null}
        <Text style={s.footer}>{inv.status === 'proforma' ? 'This is a proforma; a tax invoice is issued on payment.' : `Thank you for choosing ${t.name}.`}</Text>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(inv: InvoiceData): Promise<Buffer> {
  return Buffer.from(await renderToBuffer(<InvoiceDocument inv={inv} />));
}
