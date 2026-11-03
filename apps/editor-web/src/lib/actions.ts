import {
  applyCommands,
  assetIdFor,
  createChartElement,
  createCodeElement,
  createLineElement,
  createShapeElement,
  createTableElement,
  createTextElement,
  parseDocument,
  SlideElement,
  type AssetMeta,
  type ChartElement,
  type CodeElement,
  type DeckDocument,
  type ShapeKind,
  type Slide,
} from '@hps/document-core';
import {
  AssetRejectedError,
  HTML_FILE_TYPES,
  PPTX_FILE_TYPES,
  saveAs,
  saveToHandle,
  ZIP_FILE_TYPES,
  type SaveOutcome,
} from '@hps/asset-manager';
import { buildDeckHtml, buildDeckZip } from '@hps/export-html';
import { buildPptx } from '@hps/export-pptx';
import { printableHtml, printDeckHtml } from '@hps/export-pdf';
import { contextFor, deckCss, renderSlide } from '@hps/slide-renderer';
import type { ExportReport, ReportItem } from '@hps/export-report';
import {
  buildPreview,
  buildSavedHtml,
  convertSlide,
  applyJournal,
  freezeSlide,
  measureSlide,
  PREVIEW_SANDBOX,
  purifyPreview,
  showSlide,
  type ConvertAdapter,
  type ConvertLoss,
} from '@hps/import-legacy-html';
import { useApp, type LegacyState, type NativeState } from '../state/store';
import { renderChartSvg, highlightCode } from './chart-code';
import { prepareUserImage } from './files';
import { captureElement, reencodePng, rasterizeElement, rasterizeSlide } from './raster';

export const APP_VERSION = '0.1.0';

const native = (): NativeState | null => {
  const { mode } = useApp.getState();
  return mode?.kind === 'native' ? mode : null;
};
const legacy = (): LegacyState | null => {
  const { mode } = useApp.getState();
  return mode?.kind === 'legacy' ? mode : null;
};
export const currentSlide = (m: NativeState): Slide => m.doc.slides[m.slideIndex]!;

const baseName = (name: string): string =>
  name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_') || 'deck';

function report(outcome: SaveOutcome, label: string): boolean {
  const app = useApp.getState();
  switch (outcome.status) {
    case 'saved':
      app.notify('success', `${label} 저장: ${outcome.name}`);
      return true;
    case 'downloaded':
      app.notify('success', `${label} 다운로드: ${outcome.name}`);
      return true;
    case 'cancelled':
      return false;
    case 'failed':
      app.notify('error', outcome.message);
      return false;
  }
}

/* ---- Keeping derived renders current ---- */

const chartFingerprints = new Map<string, string>();

/** Regenerate chart pictures and code highlighting when their data changes. */
export async function refreshDerived(): Promise<void> {
  const m = native();
  if (!m) return;
  const slide = currentSlide(m);
  for (const el of slide.elements) {
    if (el.type === 'chart') await refreshChart(m.doc, slide.id, el);
    if (el.type === 'code') await refreshCode(slide.id, el);
  }
}

async function refreshChart(doc: DeckDocument, slideId: string, el: ChartElement): Promise<void> {
  const { renderedAssetId: _old, ...data } = el;
  const print = JSON.stringify({ ...data, frame: { w: el.frame.w, h: el.frame.h }, x: 0 });
  if (chartFingerprints.get(el.id) === print && el.renderedAssetId) return;
  chartFingerprints.set(el.id, print);
  try {
    const svg = await renderChartSvg(el, doc.theme.fontFamily);
    const bytes = new TextEncoder().encode(svg);
    const id = await assetIdFor(bytes as BufferSource);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const m = native();
    if (!m) return;
    m.assets.set(id, `data:image/svg+xml;base64,${btoa(bin)}`);
    const meta: AssetMeta = {
      kind: 'svg',
      mime: 'image/svg+xml',
      size: bytes.length,
      source: 'embedded',
      name: 'chart.svg',
    };
    const r = applyCommands(m.doc, [
      { type: 'asset.add', id, meta },
      { type: 'element.update', slideId, elementId: el.id, patch: { renderedAssetId: id } },
    ]);
    // A derived render, not a user edit: it joins no undo step.
    useApp.setState({ mode: { ...m, doc: r.doc } });
  } catch {
    useApp.getState().notify('warning', '차트 미리보기를 만들지 못했습니다.');
  }
}

const codeFingerprints = new Map<string, string>();

async function refreshCode(slideId: string, el: CodeElement): Promise<void> {
  const print = `${el.language}\u0000${el.code}`;
  if (codeFingerprints.get(el.id) === print) return;
  codeFingerprints.set(el.id, print);
  const tokens = await highlightCode(el);
  const m = native();
  if (!m) return;
  const r = applyCommands(m.doc, [
    { type: 'element.update', slideId, elementId: el.id, patch: { tokens } },
  ]);
  useApp.setState({ mode: { ...m, doc: r.doc } });
}

/* ---- Insert ---- */

export function insertElement(
  kind: 'text' | 'line' | 'table' | 'chart' | 'code' | ShapeKind,
): void {
  const m = native();
  if (!m) return;
  const slideId = currentSlide(m).id;
  const page = m.doc.page;
  const theme = m.doc.theme.tokens;
  const el: SlideElement =
    kind === 'text'
      ? createTextElement()
      : kind === 'line'
        ? createLineElement()
        : kind === 'table'
          ? createTableElement()
          : kind === 'chart'
            ? createChartElement()
            : kind === 'code'
              ? createCodeElement()
              : createShapeElement(kind);
  if (el.type === 'text') el.style.color = theme.foreground;
  if (el.type === 'shape') el.fill = { type: 'solid', color: theme.accent };
  if (el.type === 'line') el.stroke.color = theme.foreground;
  el.frame.x = Math.round((page.width - el.frame.w) / 2);
  el.frame.y = Math.round((page.height - el.frame.h) / 2);
  const app = useApp.getState();
  if (app.commit([{ type: 'element.add', slideId, element: el }], `${kind} 삽입`)) {
    app.setSelection([el.id]);
    void refreshDerived();
  }
}

export async function insertImageFile(file: File): Promise<void> {
  const m = native();
  if (!m) return;
  const app = useApp.getState();
  try {
    const prepared = await prepareUserImage(new Uint8Array(await file.arrayBuffer()), file);
    const page = m.doc.page;
    const nw = prepared.meta.width ?? 1024;
    const nh = prepared.meta.height ?? 768;
    const scale = Math.min((page.width * 0.6) / nw, (page.height * 0.6) / nh, 1);
    const w = Math.max(16, Math.round(nw * scale));
    const h = Math.max(16, Math.round(nh * scale));
    const frame = {
      x: Math.round((page.width - w) / 2),
      y: Math.round((page.height - h) / 2),
      w,
      h,
      rotate: 0,
    };
    const el =
      prepared.meta.kind === 'svg'
        ? SlideElement.parse({
            id: `el-${crypto.randomUUID()}`,
            type: 'svg',
            assetId: prepared.id,
            frame,
            alt: file.name,
          })
        : SlideElement.parse({
            id: `el-${crypto.randomUUID()}`,
            type: 'image',
            assetId: prepared.id,
            frame,
            alt: file.name,
            naturalWidth: nw,
            naturalHeight: nh,
          });
    m.assets.set(prepared.id, prepared.dataUrl);
    if (
      app.commit(
        [
          { type: 'asset.add', id: prepared.id, meta: prepared.meta },
          { type: 'element.add', slideId: currentSlide(m).id, element: el },
        ],
        '사진 삽입',
      )
    ) {
      app.setSelection([el.id]);
    }
    for (const f of prepared.findings) app.notify('info', f.title);
  } catch (e) {
    app.notify(
      'error',
      e instanceof AssetRejectedError
        ? `사진을 넣지 않았습니다: ${e.message}`
        : `사진을 넣지 못했습니다: ${(e as Error).message}`,
    );
  }
}

export function pickFile(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

export const IMAGE_ACCEPT =
  'image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml,image/bmp';

/* ---- Save ---- */

async function nativeHtmlBytes(m: NativeState, mode: 'editable' | 'present') {
  // Re-validate: what goes to disk must be readable by this app again.
  const doc = parseDocument(JSON.parse(JSON.stringify(m.doc)));
  return buildDeckHtml(doc, m.assets, { mode, appVersion: APP_VERSION, fontCss: fontCss(m) });
}

export function fontCss(m: NativeState): string {
  return Object.entries(m.doc.assets)
    .filter(([id, meta]) => meta.kind === 'font' && m.assets.has(id))
    .map(
      ([id, meta]) =>
        `@font-face{font-family:'${(meta.name ?? id).replace(/['\\;{}<>]/g, '')}';src:url("${m.assets.get(id)}");font-display:swap}`,
    )
    .join('');
}

export async function saveDocument(forceAs = false): Promise<void> {
  const app = useApp.getState();
  const n = native();
  const l = legacy();
  if (n) {
    app.setBusy('저장하는 중…');
    try {
      const out = await nativeHtmlBytes(n, 'editable');
      out.warnings.forEach((w) => app.notify('warning', w));
      const name = `${baseName(n.doc.meta.title)}.html`;
      const outcome =
        n.fileHandle && !forceAs
          ? await saveToHandle(n.fileHandle, out.bytes)
          : await saveAs(out.bytes, name, 'text/html', HTML_FILE_TYPES);
      if (report(outcome, 'HTML')) {
        app.markSaved(outcome.status === 'saved' ? outcome.handle : n.fileHandle);
        await saveManualSnapshot(n);
      }
    } catch (e) {
      app.notify(
        'error',
        `저장하지 못했습니다: ${(e as Error).message}. 원본 파일은 바뀌지 않았습니다.`,
      );
    } finally {
      useApp.getState().setBusy(null);
    }
    return;
  }
  if (l) {
    if (l.fileHandle && !forceAs) {
      app.setDialog({
        type: 'confirm-overwrite',
        name: l.fileHandle.name,
        changes: l.journal.length,
      });
      return;
    }
    await saveLegacy(true);
  }
}

async function saveManualSnapshot(m: NativeState): Promise<void> {
  const { localStore } = await import('../state/store');
  await localStore.saveSnapshot(m.doc, m.assets, 'manual').catch(() => undefined);
}

export async function saveLegacy(asNew: boolean): Promise<void> {
  const app = useApp.getState();
  const l = legacy();
  if (!l) return;
  app.setBusy('저장하는 중…');
  try {
    const out = await buildSavedHtml(l.session, { journal: l.journal, slides: l.session.slides });
    if (out.conflicts.length) {
      out.conflicts.forEach((c) => app.notify('error', c.message));
      app.notify(
        'error',
        `수정 ${out.conflicts.length}건을 적용하지 못했습니다. 나머지는 저장합니다.`,
      );
    }
    const original = l.session.fileName;
    // The first save suggests a new name: the original stays as it was unless the user picks it.
    const suggested = /\.edited\.html?$/i.test(original)
      ? original
      : `${baseName(original)}.edited.html`;
    const outcome =
      asNew || !l.fileHandle
        ? await saveAs(out.bytes, suggested, 'text/html', HTML_FILE_TYPES)
        : await saveToHandle(l.fileHandle, out.bytes);
    if (report(outcome, 'HTML'))
      app.markSaved(outcome.status === 'saved' ? outcome.handle : l.fileHandle);
  } catch (e) {
    app.notify(
      'error',
      `저장하지 못했습니다: ${(e as Error).message}. 원본 파일은 바뀌지 않았습니다.`,
    );
  } finally {
    useApp.getState().setBusy(null);
  }
}

export async function exportHtml(mode: 'editable' | 'present'): Promise<void> {
  const app = useApp.getState();
  const n = native();
  if (!n) return;
  try {
    const out = await nativeHtmlBytes(n, mode);
    out.warnings.forEach((w) => app.notify('warning', w));
    const suffix = mode === 'present' ? '.present' : '';
    report(
      await saveAs(
        out.bytes,
        `${baseName(n.doc.meta.title)}${suffix}.html`,
        'text/html',
        HTML_FILE_TYPES,
      ),
      'HTML',
    );
  } catch (e) {
    app.notify('error', `내보내지 못했습니다: ${(e as Error).message}`);
  }
}

export async function exportZip(): Promise<void> {
  const app = useApp.getState();
  const n = native();
  if (!n) return;
  try {
    const bytes = await buildDeckZip(parseDocument(JSON.parse(JSON.stringify(n.doc))), n.assets, {
      appVersion: APP_VERSION,
    });
    report(
      await saveAs(bytes, `${baseName(n.doc.meta.title)}.zip`, 'application/zip', ZIP_FILE_TYPES),
      'ZIP',
    );
  } catch (e) {
    app.notify('error', `내보내지 못했습니다: ${(e as Error).message}`);
  }
}

export async function exportJson(): Promise<void> {
  const n = native();
  if (!n) return;
  const bytes = new TextEncoder().encode(JSON.stringify(n.doc, null, 2));
  report(
    await saveAs(bytes, `${baseName(n.doc.meta.title)}.json`, 'application/json', [
      { description: 'JSON', accept: { 'application/json': ['.json'] } },
    ]),
    'JSON',
  );
}

/* ---- Legacy conversion: an isolated offscreen frame per run. ---- */

export async function withLegacyFrame<T>(
  l: LegacyState,
  cb: (doc: Document) => Promise<T>,
): Promise<T> {
  const { output } = applyJournal(l.session.index, l.journal);
  const preview = buildPreview(output, {
    allowExternal: l.allowExternal,
    localAssets: l.localAssets,
  });
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', PREVIEW_SANDBOX);
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;left:-100000px;top:0;width:1920px;height:1080px;border:0';
  frame.srcdoc = purifyPreview(preview.html, window);
  const loaded = new Promise<void>((r) =>
    frame.addEventListener('load', () => r(), { once: true }),
  );
  document.body.appendChild(frame);
  try {
    await loaded;
    return await cb(frame.contentDocument!);
  } finally {
    frame.remove();
  }
}

async function urlToAsset(url: string): Promise<{ id: string; bytes: Uint8Array; mime: string }> {
  const res = await fetch(url);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return {
    id: await assetIdFor(bytes as BufferSource),
    bytes,
    mime: res.headers.get('content-type')?.split(';')[0] ?? 'image/png',
  };
}

interface ConversionOutcome {
  doc: DeckDocument;
  assets: Map<string, string>;
  losses: ConvertLoss[];
  stats: Record<string, number>;
}

/** Native deck from a legacy session: L2 elements, or L3 one picture per slide. */
export async function convertLegacy(
  l: LegacyState,
  level: 'L2' | 'L3',
  progress?: (i: number, n: number) => void,
): Promise<ConversionOutcome> {
  return withLegacyFrame(l, async (frameDoc) => {
    const assets = new Map<string, string>();
    const metas: Record<string, AssetMeta> = {};
    const ids = l.session.slides.length ? l.session.slides : ['__whole__'];
    const slides: Slide[] = [];
    const losses: ConvertLoss[] = [];
    const stats: Record<string, number> = {};
    let page = { width: 1920, height: 1080 };
    for (const [i, _id] of ids.entries()) {
      progress?.(i, ids.length);
      const el = l.session.slides.length ? showSlide(frameDoc, l.session.slides, i) : frameDoc.body;
      if (!el) continue;
      await Promise.all([...frameDoc.images].map((img) => img.decode().catch(() => undefined)));
      const box = measureSlide(el);
      if (i === 0)
        page = { width: 1920, height: Math.round((1920 * box.height) / Math.max(1, box.width)) };
      const adapter: ConvertAdapter = {
        page,
        addAsset: async (dataUrl, meta) => {
          const { id, bytes, mime } = await urlToAsset(dataUrl);
          assets.set(id, dataUrl);
          metas[id] = {
            kind: meta.kind,
            mime,
            size: bytes.length,
            source: 'embedded',
            ...(meta.name ? { name: meta.name } : {}),
          };
          return id;
        },
        capture: (target) => {
          const r = target.getBoundingClientRect();
          return captureElement(
            target,
            Math.max(1, Math.round(r.width)),
            Math.max(1, Math.round(r.height)),
          );
        },
      };
      const result =
        level === 'L2' ? await convertSlide(el, i, adapter) : await freezeSlide(el, i, adapter);
      slides.push(result.slide);
      losses.push(...result.losses);
      for (const [k, v] of Object.entries(result.stats)) stats[k] = (stats[k] ?? 0) + v;
    }
    const doc = parseDocument({
      formatVersion: 2,
      docId: `doc-${crypto.randomUUID()}`,
      appVersion: APP_VERSION,
      meta: { title: baseName(l.session.fileName) },
      page: { ...page, unit: 'model-px', ratio: `${page.width}:${page.height}` },
      theme: {},
      assets: metas,
      slides,
    });
    return { doc, assets, losses, stats };
  });
}

const lossItems = (losses: ConvertLoss[]): ReportItem[] =>
  losses.map((x) => ({
    slide: x.slide + 1,
    code: `convert-${x.kind}`,
    severity: x.kind === 'dropped' ? 'error' : 'warning',
    message: x.reason,
    ...(x.elementId ? { elementId: x.elementId } : {}),
  }));

export async function legacyToNative(level: 'L2' | 'L3'): Promise<void> {
  const app = useApp.getState();
  const l = legacy();
  if (!l) return;
  app.setBusy(level === 'L2' ? '요소로 변환하는 중…' : '슬라이드를 이미지로 고정하는 중…');
  try {
    const r = await convertLegacy(l, level, (i, n) =>
      useApp.getState().setBusy(`변환 중… ${i + 1}/${n}`),
    );
    const lines = [
      `슬라이드 ${r.doc.slides.length}장을 변환했습니다.`,
      `글자 ${r.stats.text ?? 0} · 사진 ${r.stats.image ?? 0} · 도형 ${r.stats.shape ?? 0} · 표 ${r.stats.table ?? 0} · SVG ${r.stats.svg ?? 0} · 이미지로 고정 ${r.stats.frozen ?? 0}`,
      ...r.losses.map((x) => `${x.slide + 1}장: ${x.reason}`),
    ];
    useApp.getState().openNative(r.doc, r.assets, { warnings: r.losses.map((x) => x.reason) });
    useApp.setState({ dirty: true });
    useApp.getState().setDialog({
      type: 'conversion',
      title: level === 'L2' ? '요소 편집으로 변환 결과' : '화면 고정 변환 결과',
      lines,
    });
  } catch (e) {
    useApp.getState().notify('error', `변환하지 못했습니다: ${(e as Error).message}`);
  } finally {
    useApp.getState().setBusy(null);
  }
}

/* ---- PPTX ---- */

export async function exportPptx(pptxMode: 'editable' | 'fidelity'): Promise<void> {
  const app = useApp.getState();
  const n = native();
  const l = legacy();
  app.setBusy(pptxMode === 'editable' ? 'PPTX를 만드는 중…' : '슬라이드를 캡처하는 중…');
  try {
    let doc: DeckDocument;
    let assets: Map<string, string>;
    let extra: ReportItem[] = [];
    let title: string;
    if (n) {
      await refreshDerived();
      const cur = native()!;
      doc = cur.doc;
      assets = cur.assets;
      title = baseName(doc.meta.title);
    } else if (l) {
      const converted = await convertLegacy(l, pptxMode === 'editable' ? 'L2' : 'L3', (i, c) =>
        useApp.getState().setBusy(`변환 중… ${i + 1}/${c}`),
      );
      doc = converted.doc;
      assets = converted.assets;
      extra = lossItems(converted.losses);
      title = baseName(l.session.fileName);
    } else return;

    const fromBg = (slide: Slide): string | undefined =>
      slide.background.type === 'image' ? assets.get(slide.background.assetId) : undefined;

    const { bytes, report: rep } = await buildPptx(
      doc,
      {
        assetUrl: (id) => assets.get(id),
        toPng: reencodePng,
        rasterizeSlide: async (slide) =>
          l && pptxMode === 'fidelity'
            ? (fromBg(slide) ?? null)
            : rasterizeSlide(doc, assets, slide),
        rasterizeElement: (el) => rasterizeElement(doc, assets, el),
      },
      { mode: pptxMode },
    );
    const merged: ExportReport = { ...rep, items: [...extra, ...rep.items] };
    const suffix = pptxMode === 'editable' ? '' : '.look';
    const saved = report(
      await saveAs(
        bytes,
        `${title}${suffix}.pptx`,
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        PPTX_FILE_TYPES,
      ),
      'PPTX',
    );
    if (saved) useApp.getState().setDialog({ type: 'export-report', report: merged });
  } catch (e) {
    useApp
      .getState()
      .notify(
        'error',
        `PPTX를 만들지 못했습니다: ${(e as Error).message}. 외관 우선 모드를 시도해 보세요.`,
      );
  } finally {
    useApp.getState().setBusy(null);
  }
}

/* ---- Print ---- */

export async function printDeck(): Promise<void> {
  const app = useApp.getState();
  const n = native();
  const l = legacy();
  try {
    if (n) {
      await refreshDerived();
      const cur = native()!;
      const ctx = contextFor(cur.doc, { mode: 'src', url: (id) => cur.assets.get(id) });
      const slides = cur.doc.slides
        .filter((s) => !s.hidden)
        .map((s) => renderSlide(s, ctx))
        .join('');
      const r = await printDeckHtml(
        printableHtml(slides, fontCss(cur) + deckCss(cur.doc.page), cur.doc.meta.title),
      );
      if (r.failedImages)
        app.notify('warning', `이미지 ${r.failedImages}개를 불러오지 못했습니다.`);
    } else if (l) {
      await printDeckHtml(legacyPrintHtml(l));
    }
  } catch (e) {
    app.notify('error', `인쇄하지 못했습니다: ${(e as Error).message}`);
  }
}

/** Legacy deck for the print dialog: every slide on its own page, at its measured size. */
export function legacyPrintHtml(l: LegacyState): string {
  const { output } = applyJournal(l.session.index, l.journal);
  const preview = buildPreview(output, {
    allowExternal: l.allowExternal,
    localAssets: l.localAssets,
  });
  const selectors = l.session.slides.map((id) => `[data-hps-id="${id}"]`).join(',');
  const css = selectors
    ? `<style data-hps-print>@page{margin:0}html,body{margin:0;padding:0;height:auto!important;overflow:visible!important}${selectors}{display:block!important;visibility:visible!important;opacity:1!important;position:relative!important;transform:none!important;break-after:page;page-break-after:always;break-inside:avoid}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style>`
    : '';
  return purifyPreview(preview.html.replace('</head>', `${css}</head>`), window);
}
