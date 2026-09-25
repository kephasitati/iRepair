/**
 * Replace a shop's FAQ from a text file — the same format as Settings → FAQ (blocks of `Q:` / `A:` separated by a
 * blank line). Custom FAQs replace the generated ones on the landing page and llms.txt.
 *
 *   npx tsx scripts/set-faqs.ts --slug primefix --file faqs.txt
 */
import './shim-server-only';
import { readFileSync } from 'node:fs';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const { withService } = await import('../lib/db');
  const { parseFaqText } = await import('../lib/core/faq-text');
  const slug = arg('slug')?.toLowerCase();
  const file = arg('file');
  if (!slug || !file) {
    console.error('Usage: npx tsx scripts/set-faqs.ts --slug shop-slug --file faqs.txt');
    process.exit(1);
  }
  const faqs = parseFaqText(readFileSync(file, 'utf8'));
  if (!faqs.length) throw new Error('No "Q: … / A: …" blocks found in the file.');

  await withService(async (tx) => {
    const [t] = await tx`select id from tenants where slug = ${slug}`;
    if (!t) throw new Error(`No shop with slug "${slug}".`);
    await tx`delete from tenant_faqs where tenant_id = ${t.id}`;
    for (const [i, f] of faqs.entries()) await tx`insert into tenant_faqs (tenant_id, position, question, answer) values (${t.id}, ${i}, ${f.q}, ${f.a})`;
  });
  console.log(`Set ${faqs.length} FAQs for "${slug}".`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
