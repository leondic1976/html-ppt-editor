import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, type Download, type Frame, type Page } from '@playwright/test';

export const LEGACY = 'fixtures/legacy-html';
export const MALICIOUS = 'fixtures/malicious-inputs';
export const OUT = join(tmpdir(), 'hps-e2e-output');

export const PNG_RED_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

/** Files to feed the app, always via the same path a user's drop takes. */
export async function dropFiles(
  page: Page,
  files: { name: string; buffer: Buffer; mime?: string }[],
): Promise<void> {
  const data = files.map((f) => ({
    name: f.name,
    b64: f.buffer.toString('base64'),
    mime: f.mime ?? 'text/html',
  }));
  await page.evaluate((items) => {
    const dt = new DataTransfer();
    for (const it of items) {
      const bytes = Uint8Array.from(atob(it.b64), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], it.name, { type: it.mime }));
    }
    const target = document.querySelector('.app')!;
    target.dispatchEvent(
      new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }),
    );
  }, data);
}

export const dropFixture = (page: Page, dir: string, name: string): Promise<void> =>
  dropFiles(page, [{ name, buffer: readFileSync(join(dir, name)) }]);

/** Forces the download path instead of the OS save dialog, which automation cannot drive. */
export async function useDownloadSaving(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined;
  });
}

export async function saveVia(
  page: Page,
  click: () => Promise<void>,
  name: string,
): Promise<{ path: string; bytes: Buffer; download: Download }> {
  const [download] = await Promise.all([page.waitForEvent('download'), click()]);
  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, name);
  mkdirSync(dirname(path), { recursive: true });
  await download.saveAs(path);
  return { path, bytes: readFileSync(path), download };
}

export const saveOutput = (name: string, data: Buffer | Uint8Array): string => {
  const path = join(OUT, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  return path;
};

export async function clickMenu(page: Page, menu: string, item: string): Promise<void> {
  await page.getByTestId(menu).click();
  await page.getByTestId(item).click();
}

export const legacyFrame = async (page: Page): Promise<Frame> => {
  const handle = await page.getByTestId('legacy-frame').elementHandle();
  const frame = await handle!.contentFrame();
  return frame!;
};

/** The element's text in the sandboxed frame. Queries from the parent because the frame has no script. */
export async function frameText(page: Page, selector: string): Promise<string | null> {
  return page.evaluate((sel) => {
    const f = document.querySelector<HTMLIFrameElement>('[data-testid="legacy-frame"]');
    return f?.contentDocument?.querySelector(sel)?.textContent ?? null;
  }, selector);
}

/** Double-click into a block and replace its text, using real input events. */
export async function editLegacyText(page: Page, selector: string, text: string): Promise<void> {
  const frame = await legacyFrame(page);
  await frame.locator(selector).first().dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(text);
  await page.keyboard.press('Control+Enter');
}

export async function openNew(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('new-doc').click();
  await expect(page.getByTestId('canvas-slide')).toBeVisible();
}
