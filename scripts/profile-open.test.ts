/** Where does opening a very large file spend its time? Run: vitest run --config scripts/vitest.scripts.ts profile-open */
import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { scanHtmlFile, decodeHtml } from '@hps/security-scan';
import { buildPreview, detectSlides, indexDocument } from '@hps/import-legacy-html';

it('profiles the open path', async () => {
  const base = readFileSync('fixtures/legacy-html/static-sections.html', 'utf8');
  const blob = Buffer.alloc(36 * 1024 * 1024, 7).toString('base64');
  const html = base.replace(
    '</body>',
    `<img src="data:image/png;base64,${blob}" alt="" style="display:none"></body>`,
  );
  const bytes = new TextEncoder().encode(html);
  const time = async <T>(label: string, fn: () => T | Promise<T>): Promise<T> => {
    const t = performance.now();
    const r = await fn();
    console.log(`${label}: ${Math.round(performance.now() - t)}ms`);
    return r;
  };
  await time('scan', () => scanHtmlFile(bytes));
  const { text } = await time('decode', () => decodeHtml(bytes));
  const index = await time('index', () => indexDocument(text));
  await time('detect', () => detectSlides(index));
  await time('buildPreview', () => buildPreview(text));
}, 300_000);
