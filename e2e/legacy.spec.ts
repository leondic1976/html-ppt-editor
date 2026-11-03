import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  clickMenu,
  dropFiles,
  dropFixture,
  editLegacyText,
  frameText,
  legacyFrame,
  LEGACY,
  OUT,
  PNG_RED_B64,
  saveOutput,
  saveVia,
  useDownloadSaving,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await useDownloadSaving(page);
  await page.goto('/');
});

test('E2E-04 static deck: edit text, save, reopen, nothing else changed', async ({ page }) => {
  await dropFixture(page, LEGACY, 'static-sections.html');
  await expect(page.getByTestId('legacy-frame')).toBeVisible();
  await expect(page.getByTestId('status-page')).toContainText('1 / 26');

  await editLegacyText(page, '.title', '수정된 발표 제목');
  await expect(page.getByTestId('save-state')).toHaveText('저장 안 됨');
  await expect(page.getByTestId('change-list')).toContainText('2026년 사업 계획');

  // Slide 13 is plan scenario A's example.
  await page.getByTestId('legacy-slide-12').click();
  await expect(page.getByTestId('status-page')).toContainText('13 / 26');
  await editLegacyText(page, '[data-n="13"] .heading', '13장 새 제목');

  const { bytes } = await saveVia(
    page,
    () => page.getByTestId('save').click(),
    'edited-static.html',
  );
  await expect(page.getByTestId('save-state')).toHaveText('저장됨');
  const saved = bytes.toString('utf8');
  const original = readFileSync(join(LEGACY, 'static-sections.html'), 'utf8');

  // Strip the sidecar: what remains must equal the original except the two edited runs.
  const body = saved.replace(
    /<script type="application\/json" id="hps-legacy-state">[\s\S]*?<\/script>/,
    '',
  );
  const expected = original
    .replace('2026년 사업 계획 발표', '수정된 발표 제목')
    .replace('13장: 주요 내용', '13장 새 제목');
  expect(body).toBe(expected);

  // Reopen the saved file: edits persist and are not applied twice.
  await clickMenu(page, 'menu-file', 'file-close');
  await dropFiles(page, [{ name: 'edited-static.html', buffer: bytes }]);
  await expect(page.getByTestId('legacy-frame')).toBeVisible();
  await expect.poll(() => frameText(page, '.title')).toBe('수정된 발표 제목');
  await expect(page.getByTestId('change-list').locator('li')).toHaveCount(2);

  const again = await saveVia(page, () => page.getByTestId('save').click(), 'edited-static-2.html');
  expect(again.bytes.toString('utf8')).toBe(saved);
});

test('script-driven deck: hidden slides can be shown and edited, and scripts never run', async ({
  page,
}) => {
  const blocked: string[] = [];
  page.on('request', (r) => {
    if (
      !r.url().startsWith('http://localhost') &&
      !r.url().startsWith('data:') &&
      !r.url().startsWith('blob:') &&
      !r.url().startsWith('about:')
    )
      blocked.push(r.url());
  });
  await dropFixture(page, LEGACY, 'js-driven.html');
  await expect(page.getByTestId('status-page')).toContainText('1 / 4');

  await page.getByTestId('legacy-slide-1').click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const d = document.querySelector<HTMLIFrameElement>(
          '[data-testid="legacy-frame"]',
        )!.contentDocument!;
        const el = d.querySelectorAll('.slide')[1]!;
        return d.defaultView!.getComputedStyle(el).display;
      }),
    )
    .toBe('flex');

  const frame = await legacyFrame(page);
  await frame.locator('.slide >> nth=1 >> h1').dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('고친 둘째');
  await page.keyboard.press('Control+Enter');

  const { bytes } = await saveVia(page, () => page.getByTestId('save').click(), 'js-edited.html');
  const saved = bytes.toString('utf8');
  expect(saved).toContain('<h1>고친 둘째</h1>');
  // The scripts are preserved for the file's own use, but never ran here.
  expect(saved).toContain("new Chart(document.getElementById('chart')");
  expect(saved).toContain('https://cdn.jsdelivr.net/npm/chart.js');
  expect(blocked).toEqual([]);

  await expect(page.getByTestId('legacy-warnings')).toContainText('스크립트');
  await expect(page.getByTestId('legacy-warnings')).toContainText('외부 리소스');
  await expect(page.getByTestId('legacy-warnings')).toContainText('찾을 수 없습니다');
});

test('LEG-003 image replacement keeps the layout, in preview and saved file', async ({ page }) => {
  await dropFixture(page, LEGACY, 'static-sections.html');
  await page.getByTestId('legacy-slide-6').click();
  const rectOf = () =>
    page.evaluate(() => {
      const d = document.querySelector<HTMLIFrameElement>(
        '[data-testid="legacy-frame"]',
      )!.contentDocument!;
      const r = d.querySelector('[data-n="7"] .photo')!.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
  const before = await rectOf();
  expect(before.w).toBeGreaterThan(100);

  const frame = await legacyFrame(page);
  await frame.locator('[data-n="7"] .photo').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('legacy-replace-image').click();
  const png = Buffer.from(PNG_RED_B64, 'base64');
  await (await chooser).setFiles({ name: '새사진.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByTestId('change-list')).toContainText('사진');

  // Wait for the rebuilt frame to apply the stored slide before measuring.
  await expect.poll(rectOf).toEqual(before);

  const { bytes } = await saveVia(page, () => page.getByTestId('save').click(), 'img-edited.html');
  await clickMenu(page, 'menu-file', 'file-close');
  await dropFiles(page, [{ name: 'img-edited.html', buffer: bytes }]);
  await expect(page.getByTestId('change-list')).toContainText('사진');
});

test('rejects an executable offered as a replacement image', async ({ page }) => {
  await dropFixture(page, LEGACY, 'static-sections.html');
  await page.getByTestId('legacy-slide-6').click();
  const frame = await legacyFrame(page);
  await frame.locator('[data-n="7"] .photo').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('legacy-replace-image').click();
  const pe = Buffer.alloc(512);
  pe.write('MZ');
  pe[60] = 128;
  pe.write('PE\0\0', 128, 'latin1');
  await (await chooser).setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: pe });
  await expect(page.locator('.notice-error')).toContainText('이미지가 아닌 파일');
  await expect(page.getByTestId('change-list')).toHaveCount(0);
});

test('undo and redo restore journal and preview', async ({ page }) => {
  await dropFixture(page, LEGACY, 'static-sections.html');
  await editLegacyText(page, '.title', '첫 수정');
  await expect.poll(() => frameText(page, '.title')).toBe('첫 수정');
  await page.getByTestId('undo').click();
  await expect.poll(() => frameText(page, '.title')).toBe('2026년 사업 계획 발표');
  await page.getByTestId('redo').click();
  await expect.poll(() => frameText(page, '.title')).toBe('첫 수정');
});

test('reveal structure and EUC-KR/CRLF bytes', async ({ page }) => {
  await dropFixture(page, LEGACY, 'reveal-like.html');
  await expect(page.getByTestId('status-page')).toContainText('1 / 3');
  await clickMenu(page, 'menu-file', 'file-close');

  await dropFixture(page, LEGACY, 'legacy-euckr.html');
  await expect(page.getByTestId('status-page')).toContainText('1 / 2');
  await expect.poll(() => frameText(page, 'h1')).toBe('옛날 제목');
  await editLegacyText(page, 'h1', '새 제목');
  const { bytes } = await saveVia(
    page,
    () => page.getByTestId('save').click(),
    'euckr-edited.html',
  );
  const text = bytes.toString('utf8');
  expect(text).toContain('<H1>새 제목</H1>');
  expect(text).toContain('charset=utf-8');
  expect(text).toContain('<DIV CLASS=slide>');
  expect(text).toContain('\r\n');
});

test('failed detection does not invent pages: manual division works', async ({ page }) => {
  await dropFixture(page, LEGACY, 'plain-webpage.html');
  await expect(page.getByTestId('legacy-warnings')).toContainText(
    '슬라이드 구분을 찾지 못했습니다',
  );
  await expect(page.getByTestId('status-page')).toContainText('1 / 1');
  await page.getByTestId('open-selector').click();
  await page.getByTestId('selector-input').fill('header, main');
  await page.getByTestId('selector-test').click();
  await expect(page.getByTestId('selector-count')).toContainText('2개');
  await page.getByTestId('selector-apply').click();
  await expect(page.getByTestId('status-page')).toContainText('1 / 2');
});

test('edits survive a browser crash through recovery', async ({ page }) => {
  await dropFixture(page, LEGACY, 'reveal-like.html');
  await editLegacyText(page, 'h2', '복구될 수정');
  await expect(page.getByTestId('autosave')).toBeVisible({ timeout: 8000 });
  page.on('dialog', (d) => void d.accept());
  await page.reload();
  await page.getByTestId('recover-legacy').click();
  await expect(page.getByTestId('legacy-frame')).toBeVisible();
  await expect.poll(() => frameText(page, 'h2')).toBe('복구될 수정');
  await expect(page.getByTestId('change-list').locator('li')).toHaveCount(1);

  // Saving to a file retires the recovery copy.
  await saveVia(page, () => page.getByTestId('save').click(), 'recovered.html');
  await page.goto('/');
  await expect(page.getByTestId('recover-legacy')).toHaveCount(0);
});

test('script-rendered deck explains itself', async ({ page }) => {
  await dropFixture(page, LEGACY, 'script-rendered.html');
  await expect(page.getByTestId('legacy-warnings')).toContainText('스크립트가 만드는 파일');
});

test('compare view shows original and edit side by side', async ({ page }) => {
  await dropFixture(page, LEGACY, 'static-sections.html');
  await editLegacyText(page, '.title', '비교용 수정');
  await clickMenu(page, 'menu-view', 'view-compare');
  await expect(page.getByTestId('compare')).toBeVisible();
  const read = (id: string) =>
    page.evaluate(
      (testId) =>
        document
          .querySelector<HTMLIFrameElement>(`[data-testid="${testId}"]`)
          ?.contentDocument?.querySelector('.title')?.textContent,
      id,
    );
  await expect.poll(() => read('compare-before')).toBe('2026년 사업 계획 발표');
  await expect.poll(() => read('compare-after')).toBe('비교용 수정');
});

test('L2 conversion yields native elements and states its losses', async ({ page }) => {
  await dropFixture(page, LEGACY, 'static-sections.html');
  await page.getByRole('button', { name: '편집' }).click();
  await page.getByTestId('legacy-l2').click();
  await expect(page.getByTestId('conversion-report')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('conversion-report')).toContainText('26장');
  await page.getByTestId('conversion-report').getByRole('button', { name: '닫기' }).click();
  await expect(page.getByTestId('canvas-slide')).toBeVisible();

  const titleBox = await page
    .locator('.canvas-slide [data-el-id]', { hasText: '2026년 사업 계획 발표' })
    .first()
    .boundingBox();
  expect(titleBox).not.toBeNull();
  // Now a real element: it can be moved.
  await page
    .locator('.canvas-slide [data-el-id]', { hasText: '2026년 사업 계획 발표' })
    .first()
    .click();
  await expect(page.getByTestId('selection-box')).toBeVisible();
  await page.keyboard.press('Shift+ArrowRight');
  const moved = await page
    .locator('.canvas-slide [data-el-id]', { hasText: '2026년 사업 계획 발표' })
    .first()
    .boundingBox();
  expect(moved!.x).toBeGreaterThan(titleBox!.x);
  await page.screenshot({ path: join(OUT, 'l2-converted.png') });

  // A list stays a list, as one element with its items' text where the original had it.
  await page.getByTestId('slide-thumb-1').click();
  const list = page.locator('.canvas-slide [data-el-id] ul');
  await expect(list).toHaveCount(1);
  await expect(list.locator('li')).toHaveText(['요점 하나', '요점 둘']);
});

test('L3 freeze and PPTX from a legacy deck, with reports', async ({ page }) => {
  await dropFixture(page, LEGACY, 'reveal-like.html');
  const look = await saveVia(
    page,
    () =>
      page
        .getByTestId('menu-export')
        .click()
        .then(() => page.getByTestId('export-pptx-look').click()),
    'reveal.look.pptx',
  );
  saveOutput('reveal.look.pptx', look.bytes);
  await expect(page.getByTestId('export-report')).toContainText('외관 우선');
  await page.getByTestId('export-report').getByRole('button', { name: '닫기' }).click();

  const edit = await saveVia(
    page,
    () =>
      page
        .getByTestId('menu-export')
        .click()
        .then(() => page.getByTestId('export-pptx-edit').click()),
    'reveal.edit.pptx',
  );
  expect(edit.bytes.length).toBeGreaterThan(1000);
  await expect(page.getByTestId('export-report-text')).toContainText('편집 우선');
  await expect(page.getByTestId('export-report-text')).toContainText('네이티브 편집 요소');
});

test('legacy print: one page per slide', async ({ page, context }) => {
  await dropFixture(page, LEGACY, 'static-sections.html');
  // Headless print is a no-op; read what would have been printed and render that.
  await page.evaluate(() => {
    (window as unknown as { __print: string[] }).__print = [];
    HTMLIFrameElement.prototype.setAttribute = new Proxy(HTMLIFrameElement.prototype.setAttribute, {
      apply(target, self, args) {
        return Reflect.apply(target, self, args);
      },
    });
  });
  await page.getByTestId('menu-export').click();
  await page.getByTestId('export-print').click();
  const printFrame = page.locator('iframe[sandbox="allow-same-origin allow-modals"]');
  await expect(printFrame).toHaveCount(1);
  const html = await printFrame.getAttribute('srcdoc');
  expect(html).not.toBeNull();
  expect(html).not.toMatch(/<script/i);
  const pdfPage = await context.newPage();
  await pdfPage.setContent(html!);
  const pdf = await pdfPage.pdf({
    preferCSSPageSize: true,
    printBackground: true,
    width: '1280px',
    height: '720px',
  });
  saveOutput('legacy-print.pdf', pdf);
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  expect(pages).toBe(26);
  await pdfPage.close();
});

test('presenting a legacy deck uses the sandboxed frame and keys', async ({ page }) => {
  await dropFixture(page, LEGACY, 'reveal-like.html');
  await page.getByTestId('menu-present').click();
  await page.getByTestId('present-start').click();
  await expect(page.getByTestId('present-counter')).toHaveText('1 / 3');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('present-counter')).toHaveText('2 / 3');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('present')).toHaveCount(0);
});
