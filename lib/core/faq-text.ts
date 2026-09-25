import type { Faq } from '@/lib/faq';

/**
 * The plain-text FAQ format shop admins edit in Settings (and `scripts/set-faqs.ts` reads from a file):
 * blocks separated by a blank line, each starting with `Q:` and then `A:` (the answer may span lines).
 */
export function parseFaqText(text: string): Faq[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => {
      const m = block.trim().match(/^Q:\s*([\s\S]*?)\n\s*A:\s*([\s\S]*)$/i);
      return m ? { q: m[1].replace(/\s+/g, ' ').trim(), a: m[2].replace(/\s+/g, ' ').trim() } : null;
    })
    .filter((f): f is Faq => !!f && f.q.length > 0 && f.a.length > 0);
}

export function formatFaqText(faqs: Faq[]): string {
  return faqs.map((f) => `Q: ${f.q}\nA: ${f.a}`).join('\n\n');
}
