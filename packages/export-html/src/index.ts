import JSZip from 'jszip';
import { parse } from 'parse5';
import {
  assetIdFor,
  DocumentValidationError,
  jsonForScriptTag,
  parseDocument,
  type DeckDocument,
} from '@hps/document-core';
import { contextFor, deckCss, esc, renderSlide, RENDERER_VERSION } from '@hps/slide-renderer';
import { DECK_RUNTIME, DECK_SHELL_CSS } from './runtime.js';

export { DECK_RUNTIME } from './runtime.js';

export const FORMAT_MARKER = 'hps-format';
const DOC_BLOCK = 'hps-document';
const ASSET_BLOCK = 'hps-assets';

/** asset id -> data URL. One entry per unique file, however many slides use it. */
export type AssetData = Map<string, string>;

export type HtmlMode = 'editable' | 'present';

export interface ExternalDependency {
  url: string;
  kind: string;
}

export interface HtmlExportResult {
  html: string;
  bytes: Uint8Array;
  sizeBytes: number;
  /** True only when nothing outside the file is needed to present it. */
  selfContained: boolean;
  externalDependencies: ExternalDependency[];
  missingAssets: string[];
  warnings: string[];
}

export const SIZE_WARNING_BYTES = 20 * 1024 * 1024;

async function cspFor(allowExternal: boolean): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(DECK_RUNTIME));
  const hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
  const https = allowExternal ? ' https:' : '';
  return `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src data: blob:${https}; font-src data:${https}; connect-src 'none'; form-action 'none'; base-uri 'none'`;
}

function usedAssetIds(doc: DeckDocument): Set<string> {
  const ids = new Set<string>();
  for (const s of doc.slides) {
    if (s.background.type === 'image') ids.add(s.background.assetId);
    for (const el of s.elements) {
      if (el.type === 'image' || el.type === 'svg') ids.add(el.assetId);
      if (el.type === 'chart' && el.renderedAssetId) ids.add(el.renderedAssetId);
    }
  }
  return ids;
}

export interface HtmlExportOptions {
  mode?: HtmlMode;
  now?: () => Date;
  appVersion?: string;
  /** Embedded @font-face rules, already containing data: URLs. */
  fontCss?: string;
}

/** Native deck as one HTML file that opens from file:// with no server (ADR-002). */
export async function buildDeckHtml(
  input: DeckDocument,
  assets: AssetData,
  opts: HtmlExportOptions = {},
): Promise<HtmlExportResult> {
  const mode = opts.mode ?? 'editable';
  const doc: DeckDocument = {
    ...input,
    appVersion: opts.appVersion ?? input.appVersion,
    rendererVersion: RENDERER_VERSION,
    lastSavedAt: (opts.now?.() ?? new Date()).toISOString(),
  };

  const used = usedAssetIds(doc);
  const external: ExternalDependency[] = [];
  const missing: string[] = [];
  const store: Record<string, string> = {};
  const urls = new Map<string, string>();
  for (const id of used) {
    const meta = doc.assets[id];
    const data = assets.get(id);
    if (meta?.source === 'external' && meta.url) {
      external.push({ url: meta.url, kind: meta.kind });
      urls.set(id, meta.url);
      store[id] = meta.url;
    } else if (data) {
      urls.set(id, data);
      store[id] = data;
    } else missing.push(id);
  }

  const ctx =
    mode === 'present'
      ? contextFor(doc, { mode: 'src', url: (id) => urls.get(id) })
      : contextFor(doc, { mode: 'hydrate' });

  const visible = doc.slides.filter((s) => !s.hidden || mode === 'editable');
  const slidesHtml = visible
    .map((slide) => {
      const body = renderSlide(slide, ctx);
      const withNotes = slide.notes
        ? body.replace('<section ', `<section data-notes="${esc(slide.notes)}" `)
        : body;
      return slide.hidden ? '' : withNotes;
    })
    .join('\n');

  const csp = await cspFor(external.length > 0);
  const dataBlocks =
    mode === 'editable'
      ? `<script type="application/json" id="${DOC_BLOCK}">${jsonForScriptTag(doc)}</script>\n<script type="application/json" id="${ASSET_BLOCK}">${jsonForScriptTag(store)}</script>`
      : '';

  const html = `<!doctype html>
<html lang="${esc(doc.meta.locale)}" data-w="${doc.page.width}" data-h="${doc.page.height}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="${FORMAT_MARKER}" content="${doc.formatVersion};${mode}">
<meta name="generator" content="HTML-PPT Studio ${esc(doc.appVersion)}">
<title>${esc(doc.meta.title)}</title>
<style>${opts.fontCss ?? ''}${deckCss(doc.page)}${DECK_SHELL_CSS}</style>
</head>
<body>
<main id="hps-stage">
${slidesHtml}
</main>
<div id="hps-counter"></div>
<div id="hps-notes"></div>
<div id="hps-help">→ 다음 · ← 이전 · F 전체 화면 · N 발표자 노트 · Ctrl+P 인쇄</div>
${dataBlocks}
<script>${DECK_RUNTIME}</script>
</body>
</html>
`;
  const bytes = new TextEncoder().encode(html);
  const warnings: string[] = [];
  if (missing.length)
    warnings.push(`이미지 ${missing.length}개를 찾을 수 없어 빈 칸으로 저장했습니다.`);
  if (external.length)
    warnings.push(
      `외부 리소스 ${external.length}개에 의존합니다. 인터넷 없이는 일부가 표시되지 않습니다.`,
    );
  if (bytes.length > SIZE_WARNING_BYTES) {
    warnings.push(
      `파일이 ${(bytes.length / 1024 / 1024).toFixed(1)}MB입니다. 크다면 HTML + assets ZIP 저장을 고려하세요.`,
    );
  }
  if (mode === 'present') warnings.push('발표 전용 파일은 이 앱에서 다시 편집할 수 없습니다.');
  return {
    html,
    bytes,
    sizeBytes: bytes.length,
    selfContained: external.length === 0 && missing.length === 0,
    externalDependencies: external,
    missingAssets: missing,
    warnings,
  };
}

/* ---- Reading back ---- */

interface Node5 {
  nodeName: string;
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Node5[];
  value?: string;
}

export interface DeckParseResult {
  doc: DeckDocument;
  assets: AssetData;
  warnings: string[];
  /** False when the file has scripts other than this app's runtime. They are never run by the editor. */
  runtimeIntact: boolean;
}

export const hasDeckMarker = (text: string): boolean =>
  text.slice(0, 4096).includes(`name="${FORMAT_MARKER}"`);

const DATA_URL_B64 = /^data:([^;,]+);base64,(.*)$/s;

const bytesOf = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/**
 * Parse an exported deck. The file is data: JSON is schema-validated, every asset's hash is checked
 * against its id, and nothing in the file is executed.
 */
export async function parseDeckHtml(text: string): Promise<DeckParseResult | null> {
  if (!hasDeckMarker(text)) return null;
  const root = parse(text) as unknown as Node5;
  let docJson: string | null = null;
  let assetJson: string | null = null;
  const scripts: string[] = [];
  const stack: Node5[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.tagName === 'script') {
      const id = n.attrs?.find((a) => a.name === 'id')?.value;
      const body = (n.childNodes ?? []).map((c) => c.value ?? '').join('');
      if (id === DOC_BLOCK && docJson === null) docJson = body;
      else if (id === ASSET_BLOCK && assetJson === null) assetJson = body;
      else scripts.push(body);
    }
    if (n.childNodes) stack.push(...n.childNodes);
  }
  if (docJson === null) return null;

  const warnings: string[] = [];
  let json: unknown;
  try {
    json = JSON.parse(docJson);
  } catch {
    throw new DocumentValidationError('문서 JSON을 읽을 수 없습니다.', [
      { path: '', message: 'invalid JSON' },
    ]);
  }
  const doc = parseDocument(json);

  const assets: AssetData = new Map();
  if (assetJson) {
    const store = JSON.parse(assetJson) as Record<string, string>;
    for (const [id, value] of Object.entries(store)) {
      if (typeof value !== 'string') continue;
      if (doc.assets[id]?.source === 'external') continue;
      const m = DATA_URL_B64.exec(value);
      if (!m) {
        warnings.push(`자산 ${id.slice(0, 16)}… 형식이 올바르지 않아 제외했습니다.`);
        continue;
      }
      // A file whose picture does not match its recorded hash was altered after saving.
      const actual = await assetIdFor(bytesOf(m[2]!) as BufferSource);
      if (actual !== id) {
        warnings.push(
          `자산 ${id.slice(0, 16)}…의 해시가 맞지 않아 제외했습니다(파일 변조 가능성).`,
        );
        continue;
      }
      assets.set(id, value);
    }
  }
  const runtimeIntact = scripts.length === 1 && scripts[0] === DECK_RUNTIME;
  if (!runtimeIntact) {
    warnings.push(
      '이 파일에는 앱이 만들지 않은 스크립트가 있습니다. 편집기는 실행하지 않고 무시합니다. 다시 저장하면 제거됩니다.',
    );
  }
  return { doc, assets, warnings, runtimeIntact };
}

/* ---- HTML + assets ZIP, for decks too large for one file ---- */

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

export const ZIP_LIMITS = {
  maxEntries: 5000,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
  maxRatio: 200,
};

export async function buildDeckZip(
  doc: DeckDocument,
  assets: AssetData,
  opts: HtmlExportOptions = {},
): Promise<Uint8Array> {
  const zip = new JSZip();
  const refs: AssetData = new Map();
  for (const [id, url] of assets) {
    const m = DATA_URL_B64.exec(url);
    if (!m) continue;
    const name = `assets/${id.slice(7, 39)}.${EXT[m[1]!] ?? 'bin'}`;
    zip.file(name, bytesOf(m[2]!));
    refs.set(id, url);
  }
  const single = await buildDeckHtml(doc, refs, { ...opts, mode: 'present' });
  let html = single.html;
  for (const [id, url] of refs) {
    const m = DATA_URL_B64.exec(url)!;
    const rel = `assets/${id.slice(7, 39)}.${EXT[m[1]!] ?? 'bin'}`;
    html = html.split(esc(url)).join(rel);
  }
  // Relative files need 'self'; this variant is the only one that loads anything beyond itself.
  html = html.replace('img-src data: blob:', "img-src data: blob: 'self' file:");
  zip.file('index.html', html);
  zip.file(
    'deck.json',
    jsonForScriptTag({ ...doc, lastSavedAt: (opts.now?.() ?? new Date()).toISOString() }),
  );
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

interface ZipEntryInternal {
  _data?: { uncompressedSize?: number; compressedSize?: number };
}

/** Checks sizes from the ZIP directory before decompressing anything (ZIP-bomb guard). */
export async function parseDeckZip(bytes: Uint8Array): Promise<DeckParseResult> {
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  if (entries.length > ZIP_LIMITS.maxEntries) throw new Error('ZIP 안의 파일이 너무 많습니다.');
  let total = 0;
  for (const e of entries) {
    const info = (e as unknown as ZipEntryInternal)._data;
    const size = info?.uncompressedSize ?? 0;
    const packed = info?.compressedSize ?? 0;
    total += size;
    if (total > ZIP_LIMITS.maxTotalBytes) throw new Error('압축을 풀면 크기가 너무 큽니다.');
    if (packed > 0 && size / packed > ZIP_LIMITS.maxRatio && size > 10 * 1024 * 1024) {
      throw new Error('압축률이 비정상적입니다(ZIP 폭탄 가능성).');
    }
  }
  const deck = zip.file('deck.json');
  if (!deck) throw new Error('deck.json이 없는 ZIP입니다.');
  const doc = parseDocument(JSON.parse(await deck.async('string')));
  const assets: AssetData = new Map();
  const warnings: string[] = [];
  for (const [id, meta] of Object.entries(doc.assets)) {
    if (meta.source === 'external') continue;
    const file = zip.file(new RegExp(`^assets/${id.slice(7, 39)}\\.`))[0];
    if (!file) {
      warnings.push(`자산 ${id.slice(0, 16)}…이 ZIP에 없습니다.`);
      continue;
    }
    const data = await file.async('uint8array');
    if ((await assetIdFor(data as BufferSource)) !== id) {
      warnings.push(`자산 ${id.slice(0, 16)}…의 해시가 맞지 않아 제외했습니다.`);
      continue;
    }
    let bin = '';
    for (let i = 0; i < data.length; i += 0x8000)
      bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
    assets.set(id, `data:${meta.mime};base64,${btoa(bin)}`);
  }
  return { doc, assets, warnings, runtimeIntact: true };
}
