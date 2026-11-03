import { scanHtmlFile, type ScanOptions, type ScanReport } from '@hps/security-scan';

/** Runs in a Web Worker so a hostile or huge file cannot freeze the editor. */
self.onmessage = async (e: MessageEvent<{ bytes: Uint8Array; opts: ScanOptions }>) => {
  try {
    const report: ScanReport = await scanHtmlFile(e.data.bytes, e.data.opts);
    self.postMessage({ ok: true, report });
  } catch (err) {
    self.postMessage({ ok: false, error: (err as Error).message });
  }
};
