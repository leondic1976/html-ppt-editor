import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizedForCompare } from '@hps/document-core';
import { buildDeckHtml, parseDeckHtml } from '@hps/export-html';

describe('golden native deck', () => {
  const html = readFileSync('fixtures/native-decks/golden.html', 'utf8');

  it('opens intact with its runtime and assets verified', async () => {
    const r = (await parseDeckHtml(html))!;
    expect(r.doc.slides).toHaveLength(3);
    expect(r.runtimeIntact).toBe(true);
    expect(r.warnings).toEqual([]);
    expect(r.assets.size).toBe(2);
  });

  it('round-trips to the same normalised model', async () => {
    const first = (await parseDeckHtml(html))!;
    const out = await buildDeckHtml(first.doc, first.assets);
    const second = (await parseDeckHtml(out.html))!;
    expect(normalizedForCompare(second.doc)).toBe(normalizedForCompare(first.doc));
    expect(second.assets).toEqual(first.assets);
  });
});
