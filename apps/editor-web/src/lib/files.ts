import { parseDocument, DocumentValidationError } from '@hps/document-core';
import {
  bytesToDataUrl,
  prepareImage,
  AssetRejectedError,
  type PreparedAsset,
} from '@hps/asset-manager';
import { hasDeckMarker, parseDeckHtml, parseDeckZip } from '@hps/export-html';
import { importDeckJson, importMarkdown } from '@hps/import-md-json';
import { openLegacy } from '@hps/import-legacy-html';
import { decodeHtml, sniffImage, sniffMagic, type ScanReport } from '@hps/security-scan';
import createDOMPurify from 'dompurify';
import { useApp } from '../state/store';
import { decodeImageSize } from './raster';
import { scanInWorker } from './scan';

export const MAX_FILE_BYTES = 512 * 1024 * 1024;

export const blocksOpening = (r: ScanReport): boolean =>
  r.findings.some((f) => f.ruleId.startsWith('file.'));

export const needsDecision = (r: ScanReport): boolean =>
  r.verdict === 'malicious' || r.verdict === 'dangerous';

export function sanitizeSvg(svg: string): string {
  const purify = createDOMPurify(window);
  return purify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject', 'use', 'animate', 'set', 'image'],
    FORBID_ATTR: ['href', 'xlink:href'],
  });
}

export const prepareUserImage = (
  bytes: Uint8Array,
  file: { name: string; type: string },
): Promise<PreparedAsset> =>
  prepareImage(bytes, {
    name: file.name,
    declaredMime: file.type,
    decode: decodeImageSize,
    sanitizeSvg,
  });

/** Images dropped next to an HTML file, so `<img src="photo.png">` can resolve. */
async function collectSiblingImages(files: File[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const kind = sniffImage(bytes);
    if (kind && kind !== 'svg' && !sniffMagic(bytes)) {
      out.set(f.name, bytesToDataUrl(bytes, `image/${kind === 'jpeg' ? 'jpeg' : kind}`));
    }
  }
  return out;
}

/** After a scan or the user's decision: route by content, not by extension. */
export async function openScanned(
  bytes: Uint8Array,
  fileName: string,
  scan: ScanReport,
  siblings: Map<string, string> = new Map(),
): Promise<void> {
  const app = useApp.getState();
  app.setBusy('파일을 여는 중…');
  try {
    const text = decodeHtml(bytes).text;
    if (hasDeckMarker(text)) {
      const parsed = await parseDeckHtml(text);
      if (parsed) {
        app.openNative(parsed.doc, parsed.assets, { warnings: parsed.warnings });
        parsed.warnings.forEach((w) => app.notify('warning', w));
        return;
      }
    }
    const session = await openLegacy(bytes, { fileName, scan, localAssets: siblings });
    app.openLegacy(session, siblings);
    if (session.restoredFromSidecar) {
      app.notify('success', `이전 편집 ${session.journal.length}건을 복원했습니다.`);
    }
  } catch (e) {
    const msg =
      e instanceof DocumentValidationError
        ? e.message
        : `파일을 열 수 없습니다: ${(e as Error).message}`;
    app.notify('error', msg);
  } finally {
    useApp.getState().setBusy(null);
  }
}

const isHtml = (name: string, text: string): boolean =>
  /\.x?html?$/i.test(name) ||
  /^\s*(?:<!doctype html|<html|<!--|<head|<body|<section|<div)/i.test(text.slice(0, 2048));

/** Entry point for opening any dropped or picked files. */
export async function openFiles(files: File[], opts: { scanOnly?: boolean } = {}): Promise<void> {
  const app = useApp.getState();
  const main = files.find((f) => /\.(x?html?|json|md|markdown|zip)$/i.test(f.name)) ?? files[0];
  if (!main) return;
  if (main.size > MAX_FILE_BYTES) {
    app.notify('error', `파일이 너무 큽니다(최대 ${MAX_FILE_BYTES / 1024 / 1024}MB).`);
    return;
  }
  app.setBusy('악성코드 여부를 검사하는 중…');
  try {
    const bytes = new Uint8Array(await main.arrayBuffer());

    if (!opts.scanOnly && /\.zip$/i.test(main.name) && sniffMagic(bytes)?.kind === 'zip') {
      const parsed = await parseDeckZip(bytes);
      app.openNative(parsed.doc, parsed.assets, { warnings: parsed.warnings });
      return;
    }
    if (!opts.scanOnly && /\.pptx$/i.test(main.name)) {
      app.notify('warning', 'PPTX 가져오기는 지원하지 않습니다. 이 앱은 HTML 발표자료를 엽니다.');
      return;
    }

    const report = await scanInWorker(bytes, main.name);
    useApp.getState().setLastScan(report);
    if (opts.scanOnly) {
      useApp.getState().setDialog({ type: 'scan', report, bytes });
      return;
    }
    if (needsDecision(report) || blocksOpening(report)) {
      useApp.getState().setDialog({ type: 'scan', report, bytes, decide: true });
      return;
    }
    if (report.verdict === 'suspicious') {
      useApp
        .getState()
        .notify(
          'warning',
          `보안 검사: 의심스러운 항목 ${report.findings.filter((f) => f.severity === 'medium').length}건. 스크립트는 실행되지 않습니다. 파일 메뉴에서 결과를 볼 수 있습니다.`,
        );
    }

    const head = decodeHtml(bytes.subarray(0, 4096)).text;
    if (/\.json$/i.test(main.name)) {
      const text = new TextDecoder().decode(bytes);
      const { doc, warnings } = importDeckJson(text);
      useApp.getState().openNative(doc, new Map(), { warnings });
      warnings.forEach((w) => useApp.getState().notify('warning', w));
      return;
    }
    if (/\.(md|markdown)$/i.test(main.name)) {
      const { doc, warnings } = importMarkdown(
        new TextDecoder().decode(bytes),
        main.name.replace(/\.\w+$/, ''),
      );
      useApp.getState().openNative(doc, new Map(), { warnings });
      warnings.forEach((w) => useApp.getState().notify('warning', w));
      return;
    }
    if (!isHtml(main.name, head)) {
      useApp
        .getState()
        .notify('error', '지원하지 않는 파일입니다. HTML, JSON, Markdown, ZIP 파일을 여세요.');
      return;
    }
    const siblings = await collectSiblingImages(files.filter((f) => f !== main));
    await openScanned(bytes, main.name, report, siblings);
  } catch (e) {
    const msg =
      e instanceof DocumentValidationError || e instanceof AssetRejectedError
        ? e.message
        : `파일을 열 수 없습니다: ${(e as Error).message}`;
    useApp.getState().notify('error', msg);
  } finally {
    useApp.getState().setBusy(null);
  }
}

/** Reopen a stored snapshot after schema validation. */
export function validatedSnapshot(doc: unknown) {
  return parseDocument(JSON.parse(JSON.stringify(doc)));
}
