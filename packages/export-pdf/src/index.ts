/**
 * Browser printing, which is a different thing from the app producing a PDF file: the user
 * chooses "Save as PDF" in the print dialog (plan §7, ADR-009). The UI labels it that way.
 * A direct PDF file needs Playwright; see scripts/deck-to-pdf.mjs.
 */
export interface PrintReadiness {
  images: number;
  failedImages: number;
  fontsReady: boolean;
}

/** Waits for fonts and images in a document, since printing earlier loses them. */
export async function waitForRender(doc: Document, timeoutMs = 15_000): Promise<PrintReadiness> {
  const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), timeoutMs));
  const fonts = await Promise.race([
    doc.fonts?.ready.then(() => 'ok' as const) ?? Promise.resolve('ok' as const),
    timeout,
  ]);
  const images = [...doc.images];
  let failed = 0;
  await Promise.race([
    Promise.all(
      images.map(async (img) => {
        try {
          if (img.src) await img.decode();
        } catch {
          failed++;
        }
      }),
    ),
    timeout,
  ]);
  return { images: images.length, failedImages: failed, fontsReady: fonts === 'ok' };
}

/** Print an already-built deck HTML in an isolated, script-free frame. */
export async function printDeckHtml(
  html: string,
  host: HTMLElement = document.body,
): Promise<PrintReadiness> {
  const frame = document.createElement('iframe');
  // allow-modals is what permits print() here. Scripts in the deck stay disabled.
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
  frame.style.cssText = 'position:fixed;left:-99999px;top:0;width:1920px;height:1080px;border:0';
  frame.srcdoc = html;
  const loaded = new Promise<void>((resolve) =>
    frame.addEventListener('load', () => resolve(), { once: true }),
  );
  host.appendChild(frame);
  await loaded;
  const doc = frame.contentDocument!;
  const readiness = await waitForRender(doc);
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
  setTimeout(() => frame.remove(), 60_000);
  return readiness;
}

/** Document built only for printing: slides stacked, nothing else, no scripts. */
export function printableHtml(slidesHtml: string, css: string, title: string): string {
  const safeTitle = title.replace(/[<>&"]/g, '');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title><style>${css}
html,body{margin:0;padding:0;background:#fff}
.hps-slide{break-after:page;page-break-after:always}
.hps-slide:last-child{break-after:auto;page-break-after:auto}
</style></head><body>${slidesHtml}</body></html>`;
}
