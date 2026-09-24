/** Standard reading width for every customer page except the full-bleed landing page. */
export default function InnerLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-3xl px-4 pt-6 pb-24">{children}</div>;
}
