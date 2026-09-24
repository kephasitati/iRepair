import { getTranslations } from 'next-intl/server';
import { Section } from '@/components/fields';
import { BenchScanner } from '@/components/bench-job';

export const metadata = { title: 'Scanner' };

export default async function ScanPage() {
  const t = await getTranslations('bench');
  return (
    <div className="mx-auto max-w-md">
      <Section title={t('scanner')}>
        <BenchScanner />
      </Section>
    </div>
  );
}
