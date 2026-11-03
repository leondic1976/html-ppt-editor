import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  dropFiles,
  dropFixture,
  legacyFrame,
  LEGACY,
  MALICIOUS,
  useDownloadSaving,
} from './helpers';

const offsite = (url: string): boolean => !/^(?:http:\/\/localhost|data:|blob:|about:)/.test(url);

test.beforeEach(async ({ page }) => {
  await useDownloadSaving(page);
  await page.goto('/');
});

test('E2E-10 hostile HTML: nothing runs and nothing leaves the machine', async ({ page }) => {
  const requests: string[] = [];
  const dialogs: string[] = [];
  page.on('request', (r) => {
    if (offsite(r.url())) requests.push(r.url());
  });
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });

  await dropFixture(page, MALICIOUS, 'xss-everywhere.html');
  // The scan flags it first; the user must opt in to open it.
  await expect(page.getByTestId('scan-dialog')).toBeVisible();
  await page.getByTestId('scan-open-anyway').click();
  await expect(page.getByTestId('legacy-frame')).toBeVisible();

  const sandbox = await page.getByTestId('legacy-frame').getAttribute('sandbox');
  expect(sandbox).toBe('allow-same-origin');
  expect(sandbox).not.toContain('allow-scripts');

  // Provoke every interactive vector the file planted.
  const frame = await legacyFrame(page);
  await frame.locator('h1').first().click();
  await frame
    .locator('#jslink')
    .click({ force: true })
    .catch(() => undefined);
  await page.waitForTimeout(800);

  const pwned = await page.evaluate(() => (window as unknown as { __pwned?: string }).__pwned);
  expect(pwned).toBeUndefined();
  expect(requests).toEqual([]);
  expect(dialogs).toEqual([]);
  expect(page.url()).toMatch(/^http:\/\/localhost/);

  const html = await page.getByTestId('legacy-frame').getAttribute('srcdoc');
  expect(html).not.toMatch(/<script|onerror=|onload=|onclick=|javascript:/i);
  expect(html).toContain('Content-Security-Policy');
});

test('the preview frame CSP holds on its own, with the sanitiser bypassed', async ({ page }) => {
  const sent: string[] = [];
  const failed: Record<string, string> = {};
  page.on('request', (r) => {
    if (offsite(r.url())) sent.push(r.url());
  });
  page.on('requestfailed', (r) => {
    failed[r.url()] = r.failure()?.errorText ?? '';
  });
  await dropFixture(page, LEGACY, 'static-sections.html');
  await expect(page.getByTestId('legacy-frame')).toBeVisible();
  // Simulates a sanitiser bug: active content reaches the frame's DOM directly.
  const outcome = await page.evaluate(async () => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="legacy-frame"]')!;
    const doc = frame.contentDocument!;
    const img = doc.createElement('img');
    img.src = 'https://evil.invalid/after-sanitizer.png';
    doc.body.appendChild(img);
    const s = doc.createElement('script');
    s.textContent = "top.__pwned='injected'";
    doc.body.appendChild(s);
    const btn = doc.createElement('button');
    btn.setAttribute('onclick', "top.__pwned='handler'");
    doc.body.appendChild(btn);
    btn.click();
    await new Promise((r) => setTimeout(r, 300));
    return (window as unknown as { __pwned?: string }).__pwned;
  });
  expect(outcome).toBeUndefined();
  await page.waitForTimeout(300);
  // Chromium reports CSP-blocked loads as requests that failed before leaving the browser.
  for (const url of sent) expect(failed[url]).toMatch(/BLOCKED_BY_CSP|csp/i);
});

test('a tampered native file cannot inject through its model', async ({ page }) => {
  await dropFixture(page, MALICIOUS, 'native-tampered.html');
  await expect(page.locator('.notice-error')).toContainText('문서 검증 실패');
  const pwned = await page.evaluate(() => (window as unknown as { __pwned?: string }).__pwned);
  expect(pwned).toBeUndefined();
});

for (const [file, rule] of [
  ['html-smuggling.html', 'combo.html-smuggling'],
  ['phishing-form.html', 'combo.phishing-form'],
  ['obfuscated-miner.html', 'miner.signature'],
  ['clickfix.html', 'combo.clipboard-shell'],
] as const) {
  test(`scan stops ${file} and names the threat`, async ({ page }) => {
    await dropFixture(page, MALICIOUS, file);
    await expect(page.getByTestId('scan-verdict')).toHaveAttribute('data-verdict', 'malicious');
    await expect(page.locator(`[data-rule="${rule}"]`)).toBeVisible();
    await expect(page.getByTestId('scan-disclaimer')).toContainText('백신을 대체하지 않으며');
    // Default is not opening.
    await page.getByTestId('scan-close').click();
    await expect(page.getByTestId('dropzone')).toBeVisible();
  });
}

test('keylogger scan reports the exfil endpoint with a line number', async ({ page }) => {
  await dropFixture(page, MALICIOUS, 'keylogger.html');
  await expect(page.getByTestId('scan-verdict')).toHaveAttribute('data-verdict', 'dangerous');
  await expect(page.locator('[data-rule="net.exfil-endpoint"]')).toContainText('2행');
  await expect(page.locator('[data-rule="combo.keylogger"]')).toBeVisible();
});

test('an executable renamed .html cannot be opened at all', async ({ page }) => {
  await dropFixture(page, MALICIOUS, 'exe-renamed.html');
  await expect(page.getByTestId('scan-verdict')).toHaveAttribute('data-verdict', 'malicious');
  await expect(page.locator('[data-rule="file.pe"]')).toBeVisible();
  await expect(page.getByTestId('scan-open-anyway')).toHaveCount(0);
});

test('the EICAR test string is detected', async ({ page }) => {
  const eicar = [
    'X5O!P%@AP[4',
    '\\PZX54(P^)7CC)7}$',
    'EICAR-STANDARD-',
    'ANTIVIRUS-TEST-FILE!$H+H*',
  ].join('');
  await dropFiles(page, [{ name: 'eicar.html', buffer: Buffer.from(`<p>${eicar}</p>`) }]);
  await expect(page.locator('[data-rule="sig.eicar"]')).toBeVisible();
});

test('a clean deck passes quietly, never labelled "safe", with the result one click away', async ({
  page,
}) => {
  await dropFixture(page, LEGACY, 'static-sections.html');
  await expect(page.getByTestId('legacy-frame')).toBeVisible();
  await expect(page.getByTestId('scan-dialog')).toHaveCount(0);
  await expect(page.getByTestId('scan-badge')).toContainText('알려진 위협 미탐지');
  await page.getByTestId('scan-badge').click();
  await expect(page.getByTestId('scan-disclaimer')).toContainText('안전하다는 보증이 아닙니다');
  await expect(page.getByTestId('scan-dialog')).not.toContainText('안전합니다');
  const hash = await page.getByTestId('scan-sha256').textContent();
  expect(hash).toMatch(/^[0-9a-f]{64}$/);
});

test('a typical script deck is not called malicious', async ({ page }) => {
  await dropFixture(page, LEGACY, 'js-driven.html');
  await expect(page.getByTestId('legacy-frame')).toBeVisible();
  await expect(page.getByTestId('scan-dialog')).toHaveCount(0);
});

test('scan-only mode from the home screen', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('scan-only').click();
  await (
    await chooser
  ).setFiles({
    name: 'x.html',
    mimeType: 'text/html',
    buffer: readFileSync(join(MALICIOUS, 'phishing-form.html')),
  });
  await expect(page.getByTestId('scan-verdict')).toHaveAttribute('data-verdict', 'malicious');
  await expect(page.getByTestId('scan-open-anyway')).toHaveCount(0);
});

test('the production app declares a CSP that stops script injection', async ({ page }) => {
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toMatch(/script-src[^;]*unsafe/);
  const ran = await page.evaluate(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__injected = 1';
    document.head.appendChild(s);
    return (window as unknown as { __injected?: number }).__injected;
  });
  expect(ran).toBeUndefined();
});
