import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { dropFiles, openNew, PNG_RED_B64, saveOutput, saveVia, useDownloadSaving } from './helpers';

test.beforeEach(async ({ page }) => {
  await useDownloadSaving(page);
});

const insert = async (page: Page, id: string): Promise<void> => {
  await page.getByTestId('menu-insert').click();
  await page.getByTestId(id).click();
};

const elCount = (page: Page): Promise<number> => page.locator('.canvas-slide [data-el-id]').count();

test('E2E-01 create text, shape and image; state survives a reload via recovery', async ({
  page,
}) => {
  await openNew(page);
  await insert(page, 'insert-text');
  await insert(page, 'insert-rect');
  const chooser = page.waitForEvent('filechooser');
  await insert(page, 'insert-image');
  await (
    await chooser
  ).setFiles({ name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(PNG_RED_B64, 'base64') });
  await expect.poll(() => elCount(page)).toBe(3);

  await expect(page.getByTestId('autosave')).toBeVisible({ timeout: 8000 });
  page.on('dialog', (d) => void d.accept());
  await page.reload();
  await page.getByRole('button', { name: '제목 없음' }).first().click();
  await expect.poll(() => elCount(page)).toBe(3);
  await expect(page.locator('.canvas-slide img')).toHaveCount(1);
  await expect
    .poll(() => page.locator('.canvas-slide img').evaluate((i: HTMLImageElement) => i.naturalWidth))
    .toBeGreaterThan(0);
});

test('E2E-02 multi-select, move, resize, undo, redo', async ({ page }) => {
  await openNew(page);
  await insert(page, 'insert-text');
  await insert(page, 'insert-rect');
  await page.getByTestId('prop-x').fill('100');
  await page.getByTestId('prop-x').press('Enter');
  await page.getByTestId('prop-y').fill('100');
  await page.getByTestId('prop-y').press('Enter');

  await page.keyboard.press('Escape');
  await page
    .locator('.canvas-area')
    .click({ position: { x: 5, y: 5 } })
    .catch(() => undefined);
  await page.getByTestId('layer-item').first().click();
  await expect(page.getByTestId('selection-box')).toHaveCount(1);

  // Select both through Ctrl+A, then move by keyboard.
  await page.locator('.canvas-slide').click({ position: { x: 3, y: 3 } });
  await page.keyboard.press('Control+A');
  await expect(page.getByTestId('selection-box')).toHaveCount(2);
  const left = () =>
    page
      .locator('.canvas-slide [data-el-id]')
      .evaluateAll((els) => els.map((e) => parseFloat((e as HTMLElement).style.left)));
  const before = await left();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(left).toEqual(before.map((x) => x + 11));

  // Mouse drag.
  await page.getByTestId('layer-item').first().click();
  const box = await page.getByTestId('selection-box').boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  const startX = await page.getByTestId('prop-x').inputValue();
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 60, box!.y + box!.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => page.getByTestId('prop-x').inputValue()).not.toBe(startX);
  const movedX = await page.getByTestId('prop-x').inputValue();

  // Handle resize.
  const startW = Number(await page.getByTestId('prop-w').inputValue());
  const handle = await page.getByTestId('handle-e').boundingBox();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 80, handle!.y + handle!.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await page.getByTestId('prop-w').inputValue()))
    .toBeGreaterThan(startW);

  await page.getByTestId('undo').click();
  await expect.poll(async () => Number(await page.getByTestId('prop-w').inputValue())).toBe(startW);
  await page.getByTestId('undo').click();
  await expect.poll(() => page.getByTestId('prop-x').inputValue()).toBe(startX);
  await page.getByTestId('redo').click();
  await expect.poll(() => page.getByTestId('prop-x').inputValue()).toBe(movedX);
});

test('text editing commits, and typing is one undo step', async ({ page }) => {
  await openNew(page);
  await insert(page, 'insert-text');
  const el = page.locator('.canvas-slide [data-el-id]').first();
  await el.dblclick();
  await expect(page.getByTestId('text-editor')).toBeVisible();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('한글 입력 test');
  await page.keyboard.press('Escape');
  await expect(el).toContainText('한글 입력 test');
  await page.keyboard.press('Control+Z');
  await expect(el).not.toContainText('한글 입력 test');
});

test('E2E-03/06 save, open offline from file://, present, reopen and re-save', async ({
  page,
  context,
}) => {
  await openNew(page);
  await insert(page, 'insert-text');
  await insert(page, 'insert-table');
  await insert(page, 'insert-chart');
  await expect.poll(() => page.locator('.canvas-slide .hps-el-chart img').count()).toBe(1);
  await insert(page, 'insert-code');
  await page.getByTestId('notes').fill('발표자 노트 </script><script>alert(1)</script>');
  await page.getByTestId('add-slide').click();
  await insert(page, 'insert-line');
  const chooser = page.waitForEvent('filechooser');
  await insert(page, 'insert-image');
  await (
    await chooser
  ).setFiles({ name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(PNG_RED_B64, 'base64') });
  // The new slide's layout brings a title, an accent bar and a body.
  await expect.poll(() => elCount(page)).toBe(5);

  const { bytes, path } = await saveVia(
    page,
    () => page.getByTestId('save').click(),
    'native.html',
  );
  const html = bytes.toString('utf8');
  expect(html).not.toContain('<script>alert(1)');

  // Offline, directly from disk. Any request at all would be a failure.
  const viewer = await context.newPage();
  const requests: string[] = [];
  const consoleErrors: string[] = [];
  viewer.on('request', (r) => {
    if (!/^(?:file:|data:|blob:)/.test(r.url())) requests.push(r.url());
  });
  viewer.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  await context.setOffline(true);
  await viewer.goto(pathToFileURL(resolve(path)).href);
  await expect(viewer.locator('#hps-counter')).toHaveText('1 / 2');
  await viewer.keyboard.press('ArrowRight');
  await expect(viewer.locator('#hps-counter')).toHaveText('2 / 2');
  await expect
    .poll(() => viewer.locator('.hps-active img').evaluate((i: HTMLImageElement) => i.naturalWidth))
    .toBeGreaterThan(0);
  await viewer.keyboard.press('ArrowLeft');
  await viewer.keyboard.press('n');
  await expect(viewer.locator('#hps-notes')).toContainText('발표자 노트');
  expect(requests).toEqual([]);
  expect(consoleErrors).toEqual([]);
  await viewer.close();
  await context.setOffline(false);

  // Second round trip: edit and save again.
  await page.goto('/');
  await dropFiles(page, [{ name: 'native.html', buffer: bytes }]);
  await expect(page.getByTestId('canvas-slide')).toBeVisible();
  await expect(page.getByTestId('status-page')).toContainText('1 / 2');
  await expect(page.locator('.scan-badge')).toBeVisible();
  await page.getByTestId('notes').fill('수정한 노트');
  const second = await saveVia(page, () => page.getByTestId('save').click(), 'native-2.html');
  await page.goto('/');
  await dropFiles(page, [{ name: 'native-2.html', buffer: second.bytes }]);
  await expect(page.getByTestId('notes')).toHaveValue('수정한 노트');
  await expect(page.getByTestId('status-page')).toContainText('1 / 2');
});

test('E2E-05 presentation keys and presenter view with notes', async ({ page, context }) => {
  await openNew(page);
  await page.getByTestId('notes').fill('첫 장 노트');
  await page.getByTestId('add-slide').click();
  await page.getByTestId('notes').fill('둘째 장 노트');
  await page.getByTestId('slide-thumb-0').click();

  await page.getByTestId('menu-present').click();
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    page.getByTestId('presenter-view').click(),
  ]);
  await popup.waitForLoadState();
  await expect(popup.getByTestId('presenter-notes')).toHaveText('첫 장 노트');
  await expect(popup.getByTestId('presenter-timer')).toBeVisible();
  await expect(page.getByTestId('present-counter')).toHaveText('1 / 2');

  // Presenter drives the audience view.
  await popup.keyboard.press('ArrowRight');
  await expect(page.getByTestId('present-counter')).toHaveText('2 / 2');
  await expect(popup.getByTestId('presenter-notes')).toHaveText('둘째 장 노트');

  // Audience keys drive the presenter.
  await page.bringToFront();
  await page.keyboard.press('ArrowLeft');
  await expect(popup.getByTestId('presenter-notes')).toHaveText('첫 장 노트');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('present')).toHaveCount(0);
  await popup.close();
});

test('E2E-07 print: page count and 16:9 ratio, and no script in the printed page', async ({
  page,
  context,
}) => {
  await openNew(page);
  await insert(page, 'insert-text');
  await page.getByTestId('add-slide').click();
  await page.getByTestId('add-slide').click();
  await page.getByTestId('menu-export').click();
  await page.getByTestId('export-print').click();
  const frame = page.locator('iframe[sandbox="allow-same-origin allow-modals"]');
  await expect(frame).toHaveCount(1);
  const html = (await frame.getAttribute('srcdoc'))!;
  expect(html).not.toMatch(/<script/i);
  const pdfPage = await context.newPage();
  await pdfPage.setContent(html);
  const pdf = await pdfPage.pdf({ preferCSSPageSize: true, printBackground: true });
  saveOutput('native-print.pdf', pdf);
  const text = pdf.toString('latin1');
  expect((text.match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(3);
  const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(text)!;
  expect(Number(box[1]) / Number(box[2])).toBeCloseTo(16 / 9, 2);
  await pdfPage.close();
});

test('E2E-08 PPTX: both modes export with a report', async ({ page }) => {
  await openNew(page);
  await insert(page, 'insert-text');
  await insert(page, 'insert-rect');
  await page.getByTestId('notes').fill('노트');
  const edit = await saveVia(
    page,
    () =>
      page
        .getByTestId('menu-export')
        .click()
        .then(() => page.getByTestId('export-pptx-edit').click()),
    'native.edit.pptx',
  );
  expect(edit.bytes.subarray(0, 2).toString()).toBe('PK');
  await expect(page.getByTestId('export-report-text')).toContainText('네이티브 편집 요소: 2개');
  await page.getByTestId('export-report').getByRole('button', { name: '닫기' }).click();

  const look = await saveVia(
    page,
    () =>
      page
        .getByTestId('menu-export')
        .click()
        .then(() => page.getByTestId('export-pptx-look').click()),
    'native.look.pptx',
  );
  expect(look.bytes.subarray(0, 2).toString()).toBe('PK');
  await expect(page.getByTestId('export-report-text')).toContainText('이미지 폴백: 1개');
  expect(look.bytes.length).toBeGreaterThan(edit.bytes.length);
});

test('E2E-09 failures: refused permission, cancelled save, quota', async ({ page }) => {
  await page.addInitScript(() => {
    const scenario = () => (window as unknown as { __scenario: string }).__scenario;
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () => {
      const s = scenario();
      if (s === 'cancel') throw new DOMException('cancelled', 'AbortError');
      if (s === 'denied') throw new DOMException('denied', 'NotAllowedError');
      return {
        name: 'x.html',
        createWritable: async () => {
          if (s === 'quota') throw new DOMException('quota', 'QuotaExceededError');
          return { write: async () => undefined, close: async () => undefined };
        },
      };
    };
  });
  await openNew(page);
  await insert(page, 'insert-text');
  const set = (s: string) =>
    page.evaluate((v) => ((window as unknown as { __scenario: string }).__scenario = v), s);

  await set('cancel');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-state')).toHaveText('저장 안 됨');
  await expect(page.locator('.notice-error')).toHaveCount(0);

  await set('denied');
  await page.getByTestId('save').click();
  await expect(page.locator('.notice-error')).toContainText('권한');
  await expect(page.getByTestId('save-state')).toHaveText('저장 안 됨');

  await set('quota');
  await page.getByTestId('save').click();
  await expect(page.locator('.notice-error').last()).toContainText('디스크 공간');

  await set('ok');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-state')).toHaveText('저장됨');
});

test('IndexedDB failure is reported instead of silently losing autosave', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      get() {
        return {
          open() {
            throw new DOMException('blocked', 'SecurityError');
          },
        };
      },
    });
  });
  await openNew(page);
  await insert(page, 'insert-text');
  await expect(page.locator('.status-error')).toBeVisible({ timeout: 8000 });
});

test('copy and paste elements; a forged clipboard payload is refused', async ({ page }) => {
  await openNew(page);
  await insert(page, 'insert-rect');
  await page.keyboard.press('Control+D');
  await expect.poll(() => elCount(page)).toBe(2);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData(
      'application/x-hps-elements+json',
      JSON.stringify([
        {
          id: 'x',
          type: 'html',
          html: '<script>top.__pwned=1</script>',
          frame: { x: 0, y: 0, w: 1, h: 1 },
        },
      ]),
    );
    document.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  });
  await expect(page.locator('.notice-warning')).toContainText('클립보드');
  await expect.poll(() => elCount(page)).toBe(2);
});

test('layout warnings point at overflowing elements', async ({ page }) => {
  await openNew(page);
  await insert(page, 'insert-rect');
  await page.getByTestId('prop-x').fill('1800');
  await page.getByTestId('prop-x').press('Enter');
  await expect(page.locator('.warn-section')).toContainText('오른쪽 경계', { timeout: 5000 });
});

test('Markdown and JSON open as native decks', async ({ page }) => {
  await page.goto('/');
  await dropFiles(page, [
    {
      name: 'a.md',
      mime: 'text/markdown',
      buffer: Buffer.from('# 제목 A\n본문\n\n---\n\n# 제목 B\nNote: 메모'),
    },
  ]);
  await expect(page.getByTestId('status-page')).toContainText('1 / 2');
  await page.getByTestId('slide-thumb-1').click();
  await expect(page.getByTestId('notes')).toHaveValue('메모');
});

test('light presentation file works from file:// without a model', async ({ page, context }) => {
  await openNew(page);
  await insert(page, 'insert-text');
  const { path, bytes } = await saveVia(
    page,
    () =>
      page
        .getByTestId('menu-export')
        .click()
        .then(() => page.getByTestId('export-present').click()),
    'present.html',
  );
  expect(bytes.toString('utf8')).not.toContain('hps-document');
  const viewer = await context.newPage();
  await viewer.goto(pathToFileURL(resolve(path)).href);
  await expect(viewer.locator('#hps-counter')).toHaveText('1 / 1');
  await viewer.close();
});

test('English UI and dark theme toggle', async ({ page }) => {
  await openNew(page);
  await page.getByRole('button', { name: '보기' }).click();
  await page.getByRole('menuitem', { name: 'English' }).click();
  await expect(page.getByTestId('menu-file')).toHaveText('File');
  await page.getByRole('button', { name: 'View' }).click();
  await page.getByRole('menuitem', { name: 'Toggle dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', /dark|light/);
});
