import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  dropFiles,
  dropFixture,
  LEGACY,
  MALICIOUS,
  openNew,
  OUT,
  saveOutput,
  saveVia,
  useDownloadSaving,
} from './helpers';

/** Fraction of pixels that differ visibly, computed in the browser on two PNGs of equal size. */
async function diffRatio(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async ([x, y]) => {
      const load = async (b64: string): Promise<ImageData> => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, c.width, c.height);
      };
      const [p, q] = await Promise.all([load(x!), load(y!)]);
      if (p.width !== q.width || p.height !== q.height) return 1;
      let diff = 0;
      for (let i = 0; i < p.data.length; i += 4) {
        const d =
          Math.abs(p.data[i]! - q.data[i]!) +
          Math.abs(p.data[i + 1]! - q.data[i + 1]!) +
          Math.abs(p.data[i + 2]! - q.data[i + 2]!);
        if (d > 48) diff++;
      }
      return diff / (p.width * p.height);
    },
    [a.toString('base64'), b.toString('base64')],
  );
}

const shot = (name: string): string => {
  mkdirSync(join(OUT, 'shots'), { recursive: true });
  return join(OUT, 'shots', name);
};

test.beforeEach(async ({ page }) => {
  await useDownloadSaving(page);
});

test('design fidelity: the preview looks like the original file opened directly', async ({
  page,
  context,
}) => {
  // The reference: the same file with its own rendering, at the slide's own size.
  const original = await context.newPage();
  await original.setViewportSize({ width: 1400, height: 800 });
  await original.goto(pathToFileURL(resolve(LEGACY, 'static-sections.html')).href);
  const reference = await original.locator('[data-n="2"]').screenshot();
  await original.close();

  await page.goto('/');
  await dropFixture(page, LEGACY, 'static-sections.html');
  await expect(page.getByTestId('legacy-frame')).toBeVisible();
  // The exact document the frame shows, rendered at scale 1 for a pixel comparison.
  const srcdoc = (await page.getByTestId('legacy-frame').getAttribute('srcdoc'))!;
  const rendered = await context.newPage();
  await rendered.setViewportSize({ width: 1400, height: 800 });
  await rendered.setContent(srcdoc);
  const preview = await rendered.locator('[data-n="2"]').screenshot();
  await rendered.close();
  const ratio = await diffRatio(page, reference, preview);
  saveOutput('fidelity-reference.png', reference);
  saveOutput('fidelity-preview.png', preview);
  console.log(`preview vs original: ${(ratio * 100).toFixed(3)}% of pixels differ`);
  expect(ratio).toBeLessThan(0.005);
});

test('exported native deck renders the same in the editor and from file://', async ({
  page,
  context,
}) => {
  await openNew(page);
  await page.getByTestId('menu-insert').click();
  await page.getByTestId('insert-table').click();
  await page.keyboard.press('Escape');
  const { path } = await saveVia(page, () => page.getByTestId('save').click(), 'parity.html');
  const canvas = await page
    .getByTestId('canvas-slide')
    .locator('.hps-slide')
    .evaluate((el) => el.innerHTML);

  const viewer = await context.newPage();
  await viewer.goto(pathToFileURL(resolve(path)).href);
  const exported = await viewer.locator('.hps-slide.hps-active').evaluate((el) => el.innerHTML);
  await viewer.close();
  // One renderer: the markup is identical (image references aside, and this slide has none).
  expect(exported).toBe(canvas);
});

test('a11y: home, native editor, legacy editor and dialogs have no serious axe violations', async ({
  page,
}) => {
  const check = async (label: string): Promise<void> => {
    const results = await new AxeBuilder({ page })
      // Slide content is the author's design, not app chrome.
      .exclude('.canvas-slide')
      .exclude('.thumb')
      .exclude('[data-testid="legacy-frame"]')
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(serious.map((v) => `${label}: ${v.id} — ${v.nodes[0]?.target}`)).toEqual([]);
  };
  await page.goto('/');
  await check('home');
  await page.getByTestId('new-doc').click();
  await expect(page.getByTestId('canvas-slide')).toBeVisible();
  await check('native');
  await page.getByTestId('menu-insert').click();
  await page.getByTestId('insert-rect').click();
  await check('native + selection');
  await page.goto('/');
  await dropFixture(page, LEGACY, 'js-driven.html');
  await expect(page.getByTestId('legacy-frame')).toBeVisible();
  await check('legacy');
  await page.getByTestId('scan-badge').click();
  await expect(page.getByTestId('scan-dialog')).toBeVisible();
  await check('scan dialog');
});

test('keyboard-only: create, select and move an element', async ({ page }) => {
  await openNew(page);
  await page.getByTestId('menu-insert').focus();
  await page.keyboard.press('Enter');
  // Menu and editor both take focus asynchronously; a key sent before that goes somewhere else.
  await expect(page.getByTestId('insert-text')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.canvas-slide [data-el-id]')).toHaveCount(1);
  await expect(page.getByTestId('text-editor')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('text-editor')).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('selection-box')).toHaveCount(1);
  const x0 = await page
    .locator('.canvas-slide [data-el-id]')
    .evaluate((e) => parseFloat((e as HTMLElement).style.left));
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() =>
      page
        .locator('.canvas-slide [data-el-id]')
        .evaluate((e) => parseFloat((e as HTMLElement).style.left)),
    )
    .toBe(x0 + 1);
});

test('visual regression: golden deck as exported', async ({ page }, info) => {
  // Baselines are per browser and OS, since text rendering differs. Windows + Chrome is the reference.
  test.skip(
    process.platform !== 'win32' || info.project.name !== 'chrome',
    'baselines exist for Windows Chrome',
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(pathToFileURL(resolve('fixtures/native-decks/golden.html')).href);
  for (let i = 1; i <= 3; i++) {
    await expect(page.locator('#hps-counter')).toHaveText(`${i} / 3`);
    await page.evaluate(() =>
      document.getElementById('hps-counter')!.setAttribute('style', 'visibility:hidden'),
    );
    // Per-slide tolerance: photos and shapes are exact, text antialiasing may vary slightly.
    await expect(page).toHaveScreenshot(`golden-${i}.png`, { maxDiffPixelRatio: 0.002 });
    await page.keyboard.press('ArrowRight');
  }
});

test('legacy deck to PPTX, for checking in real PowerPoint', async ({ page }) => {
  await page.goto('/');
  await dropFixture(page, LEGACY, 'static-sections.html');
  const edit = await saveVia(
    page,
    () =>
      page
        .getByTestId('menu-export')
        .click()
        .then(() => page.getByTestId('export-pptx-edit').click()),
    'static.edit.pptx',
  );
  expect(edit.bytes.subarray(0, 2).toString()).toBe('PK');
  const report = await page.getByTestId('export-report-text').textContent();
  saveOutput('static.edit.report.txt', Buffer.from(report ?? ''));
  await page.getByTestId('export-report').getByRole('button', { name: '닫기' }).click();
  const look = await saveVia(
    page,
    () =>
      page
        .getByTestId('menu-export')
        .click()
        .then(() => page.getByTestId('export-pptx-look').click()),
    'static.look.pptx',
  );
  expect(look.bytes.subarray(0, 2).toString()).toBe('PK');
});

test('UI screenshots for review', async ({ page }) => {
  await page.goto('/');
  await page.screenshot({ path: shot('home.png') });
  await dropFixture(page, LEGACY, 'static-sections.html');
  await expect(page.getByTestId('legacy-frame')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot('legacy.png') });
  await page.getByTestId('legacy-slide-1').click();
  const frame = await (await page.getByTestId('legacy-frame').elementHandle())!.contentFrame();
  await frame!.locator('[data-n="2"] .card h3').first().click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: shot('legacy-selected.png') });
  await page.goto('/');
  await dropFixture(page, MALICIOUS, 'xss-everywhere.html');
  await expect(page.getByTestId('scan-dialog')).toBeVisible();
  await page.screenshot({ path: shot('scan.png') });
  await page.goto('/');
  await page.getByTestId('new-doc').click();
  for (const id of ['insert-text', 'insert-chart', 'insert-rect']) {
    await page.getByTestId('menu-insert').click();
    await page.getByTestId(id).click();
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: shot('native.png') });
});

test('performance baseline (recorded, not asserted beyond sanity)', async ({ page }, info) => {
  const results: Record<string, number> = {};
  const big = await page.goto('/').then(() => bigDeckBytes());
  const t0 = Date.now();
  await dropFiles(page, [{ name: 'large.html', buffer: big }]);
  await expect(page.getByTestId('legacy-frame')).toBeVisible({ timeout: 120_000 });
  results.openLegacy26SlidesNearMaxMs = Date.now() - t0;
  results.legacyFileMB = Math.round((big.length / 1024 / 1024) * 10) / 10;
  await page.goto('/');

  await page.getByTestId('new-doc').click();
  await page.evaluate(() => {
    /* The store is not exposed, so the stress deck goes through the same file route a user has. */
  });
  const deck = stressDeck();
  await page.goto('/');
  const t1 = Date.now();
  await dropFiles(page, [
    { name: 'stress.json', mime: 'application/json', buffer: Buffer.from(JSON.stringify(deck)) },
  ]);
  await expect(page.getByTestId('status-page')).toContainText('/ 100', { timeout: 60_000 });
  results.open100Slides1000ElementsMs = Date.now() - t1;

  // Input latency: time from a keyboard nudge to the DOM reflecting it.
  await page.locator('.canvas-slide [data-el-id]').first().click();
  results.nudgeLatencyMs = await page.evaluate(async () => {
    const el = document.querySelector<HTMLElement>('.canvas-slide [data-el-id]')!;
    const id = el.dataset.elId!;
    const start = performance.now();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await new Promise<void>((resolve) => {
      const check = (): void => {
        const cur = document.querySelector<HTMLElement>(`.canvas-slide [data-el-id="${id}"]`);
        if (cur && cur.style.left !== el.style.left) resolve();
        else if (performance.now() - start > 2000) resolve();
        else requestAnimationFrame(check);
      };
      check();
    });
    return Math.round(performance.now() - start);
  });

  // Drag frame timing on the stress deck.
  const box = await page.getByTestId('selection-box').first().boundingBox();
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[] };
    w.__frames = [];
    let last = performance.now();
    const tick = (now: number): void => {
      w.__frames.push(now - last);
      last = now;
      if (w.__frames.length < 2000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(box!.x + 5, box!.y + 5);
  await page.mouse.down();
  for (let i = 0; i < 40; i++) await page.mouse.move(box!.x + 5 + i * 3, box!.y + 5 + i);
  await page.mouse.up();
  const frames = await page.evaluate(() => (window as unknown as { __frames: number[] }).__frames);
  const sorted = [...frames].sort((a, b) => a - b);
  results.dragFrameP95Ms = Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0);

  writeFileSync(
    saveOutput(`perf-${info.project.name}.json`, Buffer.from('')),
    JSON.stringify(results, null, 2),
  );
  console.log(`PERF ${info.project.name}: ${JSON.stringify(results)}`);
  expect(results.nudgeLatencyMs).toBeLessThan(1000);
});

function bigDeckBytes(): Buffer {
  const base = readFileSync(join(LEGACY, 'static-sections.html'), 'utf8');
  // Near the plan's 50MB case: large inline image data, which is what makes real decks heavy.
  const blob = Buffer.alloc(36 * 1024 * 1024, 7).toString('base64');
  const pad = `<img src="data:image/png;base64,${blob}" alt="" style="display:none">`;
  return Buffer.from(base.replace('</body>', `${pad}</body>`));
}

function stressDeck(): unknown {
  const slides = Array.from({ length: 100 }, (_, s) => ({
    id: `s${s}`,
    background: { type: 'solid', color: '#ffffff' },
    elements: Array.from({ length: 10 }, (_e, e) => ({
      id: `e${s}-${e}`,
      type: e % 2 ? 'shape' : 'text',
      frame: { x: 40 + e * 170, y: 60 + e * 90, w: 160, h: 80 },
      zIndex: e,
      ...(e % 2
        ? { shape: 'roundRect', fill: { type: 'solid', color: '#2563eb' } }
        : {
            content: {
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: `글자 ${s}-${e}` }] }],
            },
            style: { fontSizePx: 28 },
          }),
    })),
  }));
  return {
    formatVersion: 2,
    docId: 'stress',
    meta: { title: '스트레스' },
    page: {},
    theme: {},
    slides,
  };
}
