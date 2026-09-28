import { ChevronDown } from 'lucide-react';
import { formatKes } from '@/lib/core/money';
import { groupByCategory, type PublicPart } from '@/lib/public-data';

/**
 * A device's published prices, one collapsed row per category ("Screen Replacement · 61 items · from KES 2,500").
 * Long catalogues stay a short, scannable page on a phone; tapping a row shows its prices.
 */
export function PriceGroups({ parts, openFirst = false }: { parts: PublicPart[]; openFirst?: boolean }) {
  const groups = groupByCategory(parts);
  return (
    <div className="divide-y divide-fill">
      {groups.map((g, i) => {
        const from = Math.min(...g.items.map((p) => p.default_price_cents));
        return (
          <details key={g.category} open={openFirst && i === 0 && groups.length === 1} className="group py-1">
            <summary className="flex cursor-pointer list-none items-center gap-3 py-2.5 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold tracking-tight">{g.category}</span>
                <span className="block text-[13px] text-ink-3">
                  {g.items.length} {g.items.length === 1 ? 'item' : 'items'} · from {formatKes(from)}
                </span>
              </span>
              <ChevronDown className="size-4 shrink-0 text-ink-3 transition-transform duration-300 group-open:rotate-180" />
            </summary>
            <ul className="incl pb-2 text-[15px]">
              {g.items.map((p, j) => (
                <li key={`${j}-${p.name}`}>
                  <span>{p.name}</span>
                  <span className="shrink-0 font-medium tabular-nums">{formatKes(p.default_price_cents)}</span>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
