import { describe, expect, it } from 'vitest';
import { formatFaqText, parseFaqText } from '@/lib/core/faq-text';

describe('FAQ text format', () => {
  it('parses Q/A blocks, multi-line answers and CRLF, skipping malformed blocks', () => {
    const text = 'Q: Do you use original parts?\r\nA: Both original\r\nand OEM.\r\n\r\nnot a block\r\n\r\nq: Warranty?\nA: 14 days.\n\nQ: no answer\n';
    expect(parseFaqText(text)).toEqual([
      { q: 'Do you use original parts?', a: 'Both original and OEM.' },
      { q: 'Warranty?', a: '14 days.' },
    ]);
  });

  it('round-trips through formatFaqText', () => {
    const faqs = [{ q: 'One?', a: 'Yes.' }, { q: 'Two?', a: 'Also yes.' }];
    expect(parseFaqText(formatFaqText(faqs))).toEqual(faqs);
    expect(parseFaqText('')).toEqual([]);
  });
});
