import { jsonForScriptTag } from '@hps/document-core';
import { decodeHtml, scanHtmlFile, shrinkBlobs, type ScanReport } from '@hps/security-scan';
import {
  anchorHash,
  attrOf,
  indexDocument,
  parseSource,
  elementChildren,
  type AstNode,
  type LegacyIndex,
} from './ast.js';
import { detectSlides, type SlideDetection } from './detect.js';
import {
  addToJournal,
  applyJournal,
  makeKey,
  mergeStyle,
  type JournalEntry,
  type PatchConflict,
  type PatchOp,
} from './patch.js';
import { buildPreview, type PreviewOptions } from './sanitize.js';

export const SIDECAR_ID = 'hps-legacy-state';
const SIDECAR_VERSION = 1;

export type TrustLevel = 'static' | 'scripted' | 'flagged';

export interface ImportWarning {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface ImportReport {
  fileName: string;
  encoding: string;
  sizeBytes: number;
  trust: TrustLevel;
  detection: Pick<SlideDetection, 'status' | 'confidence' | 'rule' | 'notes' | 'scriptRendered'>;
  slideCount: number;
  editableTexts: number;
  editableImages: number;
  removed: { scripts: number; handlers: number; frames: number; plugins: number; other: number };
  externalResources: string[];
  missingLocalAssets: string[];
  fontsReferenced: string[];
  warnings: ImportWarning[];
}

export interface LegacySession {
  kind: 'legacy';
  fileName: string;
  /** Name of the original file, kept across save and reopen even when the saved copy is renamed. */
  originalFileName: string;
  /** Immutable base for all patches. */
  source: string;
  encoding: string;
  hasBom: boolean;
  index: LegacyIndex;
  detection: SlideDetection;
  slides: string[];
  journal: JournalEntry[];
  report: ImportReport;
  scan: ScanReport;
  restoredFromSidecar: boolean;
}

/* ---- Sidecar: original + journal travel inside the saved file, so reopening never double-applies. ---- */

export interface Sidecar {
  v: number;
  /** Deflate-compressed, base64 UTF-8 original. */
  original: string;
  encoding: string;
  hasBom: boolean;
  fileName: string;
  journal: JournalEntry[];
  slides: string[];
  /** Hash of the saved text with the sidecar removed. Mismatch: someone edited the file outside. */
  outputHash: string;
}

async function pipeBytes(
  data: Uint8Array,
  stream: { readable: ReadableStream; writable: WritableStream },
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(data);
  void writer.close();
  const buf = await new Response(stream.readable as ReadableStream<Uint8Array>).arrayBuffer();
  return new Uint8Array(buf);
}

const toBase64 = (b: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const compressText = async (text: string): Promise<string> =>
  toBase64(await pipeBytes(new TextEncoder().encode(text), new CompressionStream('deflate')));

export const decompressText = async (b64: string): Promise<string> =>
  new TextDecoder().decode(await pipeBytes(fromBase64(b64), new DecompressionStream('deflate')));

export { jsonForScriptTag };

function findSidecar(root: AstNode): { node: AstNode; json: string } | null {
  const stack = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.tagName === 'script' && attrOf(n, 'id') === SIDECAR_ID) {
      return { node: n, json: (n.childNodes ?? []).map((c) => c.value ?? '').join('') };
    }
    if (n.tagName && n.tagName !== 'head' && n.tagName !== 'html') continue;
    stack.push(...(n.childNodes ?? []));
  }
  return null;
}

/** Where an inert block can go without affecting layout or structural selectors in <body>. */
function sidecarInsertAt(source: string): number {
  const shrunk = shrinkBlobs(source);
  const root = parseSource(shrunk.text);
  const growth = (offset: number): number => shrunk.expand(shrunk.text.slice(0, offset)).length;
  const html = elementChildren(root).find((n) => n.tagName === 'html');
  const head = html && elementChildren(html).find((n) => n.tagName === 'head');
  const headEnd = head?.sourceCodeLocation?.endTag?.startOffset;
  if (headEnd !== undefined) return growth(headEnd);
  const docType = root.childNodes?.find((n) => n.nodeName === '#documentType');
  return growth(docType?.sourceCodeLocation?.endOffset ?? 0);
}

function stripRange(work: string, node: AstNode): string {
  const l = node.sourceCodeLocation!;
  return work.slice(0, l.startOffset) + work.slice(l.endOffset);
}

/* ---- Open ---- */

function fontsIn(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(/font-family\s*:\s*([^;}"<]{1,200})/gi)) {
    for (const part of m[1]!.split(',')) {
      const name = part.trim().replace(/^['"]|['"]$/g, '');
      if (
        name &&
        !/^(?:inherit|initial|sans-serif|serif|monospace|system-ui|-apple-system|var\(.*)$/i.test(
          name,
        )
      )
        found.add(name);
    }
  }
  return [...found].slice(0, 40);
}

function buildReport(
  fileName: string,
  encoding: string,
  size: number,
  source: string,
  index: LegacyIndex,
  detection: SlideDetection,
  scan: ScanReport,
  previewOpts: PreviewOptions,
): ImportReport {
  const preview = buildPreview(source, previewOpts);
  const warnings: ImportWarning[] = [];
  if (encoding !== 'utf-8') {
    warnings.push({
      code: 'encoding',
      severity: 'info',
      message: `${encoding} 인코딩 파일입니다. 저장할 때 UTF-8로 변환합니다.`,
    });
  }
  if (preview.removed.scripts) {
    warnings.push({
      code: 'scripts-removed',
      severity: 'warning',
      message: `미리보기에서 스크립트 ${preview.removed.scripts}개를 실행하지 않았습니다. 스크립트로 그리는 차트나 효과는 보이지 않을 수 있지만, 저장한 파일에는 그대로 남습니다.`,
    });
  }
  if (preview.removed.frames || preview.removed.plugins) {
    warnings.push({
      code: 'embeds-removed',
      severity: 'warning',
      message: `미리보기에서 iframe·플러그인 ${preview.removed.frames + preview.removed.plugins}개를 표시하지 않았습니다.`,
    });
  }
  if (preview.externalResources.length) {
    warnings.push({
      code: 'external',
      severity: 'warning',
      message: `외부 리소스 ${preview.externalResources.length}개를 차단했습니다. 이 파일은 완전한 오프라인 파일이 아닙니다.`,
    });
  }
  if (preview.missingLocalAssets.length) {
    warnings.push({
      code: 'missing-assets',
      severity: 'warning',
      message: `파일 밖의 리소스 ${preview.missingLocalAssets.length}개를 찾을 수 없습니다. HTML과 함께 끌어다 놓으면 연결됩니다.`,
    });
  }
  for (const note of detection.notes)
    warnings.push({ code: 'detection', severity: 'warning', message: note });
  const flagged =
    scan.verdict === 'malicious' || scan.verdict === 'dangerous' || scan.verdict === 'suspicious';
  return {
    fileName,
    encoding,
    sizeBytes: size,
    trust: flagged
      ? 'flagged'
      : scan.stats.scripts + scan.stats.eventHandlers > 0
        ? 'scripted'
        : 'static',
    detection: {
      status: detection.status,
      confidence: detection.confidence,
      rule: detection.rule,
      notes: detection.notes,
      scriptRendered: detection.scriptRendered,
    },
    slideCount: detection.slides.length,
    editableTexts: index.texts.size,
    editableImages: index.images.size,
    removed: preview.removed,
    externalResources: preview.externalResources,
    missingLocalAssets: preview.missingLocalAssets,
    fontsReferenced: fontsIn(index.work),
    warnings,
  };
}

export interface OpenOptions extends PreviewOptions {
  fileName: string;
  scan?: ScanReport;
}

export async function openLegacy(bytes: Uint8Array, opts: OpenOptions): Promise<LegacySession> {
  const decoded = decodeHtml(bytes);
  const scan = opts.scan ?? (await scanHtmlFile(bytes, { fileName: opts.fileName }));

  let source = decoded.text;
  let encoding = decoded.encoding;
  let hasBom = decoded.hasBom;
  let journal: JournalEntry[] = [];
  let storedSlides: string[] | null = null;
  let originalFileName = opts.fileName;
  let restored = false;
  const notes: ImportWarning[] = [];

  const scanText = shrinkBlobs(decoded.text);
  const side = findSidecar(parseSource(scanText.text));
  if (side) {
    const stripped = scanText.expand(stripRange(scanText.text, side.node));
    try {
      const state = JSON.parse(scanText.expand(side.json)) as Sidecar;
      if (state.v !== SIDECAR_VERSION) throw new Error('version');
      if (state.outputHash === anchorHash(stripped)) {
        source = await decompressText(state.original);
        encoding = state.encoding;
        hasBom = state.hasBom;
        journal = state.journal;
        storedSlides = state.slides;
        originalFileName = state.fileName;
        restored = true;
      } else {
        // The bytes were changed outside this app. They are the truth now; old patches don't apply.
        source = stripped;
        notes.push({
          code: 'edited-outside',
          severity: 'warning',
          message:
            '저장 후 다른 프로그램에서 수정된 파일입니다. 현재 내용을 새 원본으로 엽니다. 이전 편집 기록은 적용하지 않습니다.',
        });
      }
    } catch {
      source = stripped;
      notes.push({
        code: 'sidecar-invalid',
        severity: 'warning',
        message: '편집 기록을 읽을 수 없어 현재 내용을 원본으로 엽니다.',
      });
    }
  }

  const index = indexDocument(source);
  const detection = detectSlides(index);
  const report = buildReport(
    opts.fileName,
    encoding,
    bytes.length,
    source,
    index,
    detection,
    scan,
    opts,
  );
  report.warnings.push(...notes);
  return {
    kind: 'legacy',
    fileName: opts.fileName,
    originalFileName,
    source,
    encoding,
    hasBom,
    index,
    detection,
    slides: storedSlides ?? detection.slides,
    journal,
    report,
    scan,
    restoredFromSidecar: restored,
  };
}

/* ---- Edit ---- */

const now = (): string => new Date().toISOString();

function entry(session: LegacySession, path: string, op: PatchOp, label?: string): JournalEntry {
  return { key: makeKey(session.index, path, op), op, at: now(), ...(label ? { label } : {}) };
}

/** Text edit on a block. Returns a new journal; the session is not mutated (undo keeps snapshots). */
export function editText(
  session: LegacySession,
  journal: JournalEntry[],
  path: string,
  next: { text: string } | { html: string },
): JournalEntry[] {
  const info = session.index.texts.get(path);
  if (!info) throw new Error(`not an editable text block: ${path}`);
  const op: PatchOp =
    'text' in next ? { kind: 'text', text: next.text } : { kind: 'inner-html', html: next.html };
  return addToJournal(journal, entry(session, path, op, `글자: ${info.text.trim().slice(0, 30)}`));
}

export interface ImageReplacement {
  /** data: URL of the validated replacement. */
  dataUrl: string;
  /**
   * The rendered box of the old image. Pinning it keeps layout intact when the new picture has a
   * different aspect ratio (LEG-003).
   */
  box?: { width: number; height: number };
  fit?: 'cover' | 'contain' | 'fill';
  focal?: { x: number; y: number };
}

export function replaceImage(
  session: LegacySession,
  journal: JournalEntry[],
  path: string,
  img: ImageReplacement,
): JournalEntry[] {
  const info = session.index.images.get(path);
  const node = session.index.byId.get(path)?.node;
  if (!info || !node) throw new Error(`not a replaceable image: ${path}`);
  let next = journal;
  const label = `사진: ${info.src.slice(0, 40)}`;
  if (info.kind === 'inline-bg') {
    const style = attrOf(node, 'style') ?? '';
    const replaced = style.replace(/url\(\s*["']?[^"')]*["']?\s*\)/i, `url("${img.dataUrl}")`);
    return addToJournal(
      next,
      entry(session, path, { kind: 'attr', name: 'style', value: replaced }, label),
    );
  }
  const attrName =
    info.kind === 'svg-image'
      ? attrOf(node, 'href') !== undefined
        ? 'href'
        : 'xlink:href'
      : 'src';
  next = addToJournal(
    next,
    entry(session, path, { kind: 'attr', name: attrName, value: img.dataUrl }, label),
  );
  if (attrOf(node, 'srcset') !== undefined) {
    // Otherwise the browser may keep showing a srcset candidate of the old picture.
    next = addToJournal(next, entry(session, path, { kind: 'remove-attr', name: 'srcset' }, label));
  }
  if (info.kind === 'img' && img.box && img.box.width > 0 && img.box.height > 0) {
    const fit = img.fit ?? 'cover';
    const focal = img.focal ?? { x: 0.5, y: 0.5 };
    const style = mergeStyle(attrOf(node, 'style'), {
      width: `${Math.round(img.box.width)}px`,
      height: `${Math.round(img.box.height)}px`,
      'object-fit': fit,
      'object-position': `${Math.round(focal.x * 100)}% ${Math.round(focal.y * 100)}%`,
    });
    next = addToJournal(
      next,
      entry(session, path, { kind: 'attr', name: 'style', value: style }, label),
    );
  }
  return next;
}

/** L1 CSS edit: inline declarations only, merged with what the element already has. */
export function editStyle(
  session: LegacySession,
  journal: JournalEntry[],
  path: string,
  updates: Record<string, string | null>,
): JournalEntry[] {
  const node = session.index.byId.get(path)?.node;
  if (!node) throw new Error(`unknown node: ${path}`);
  const prior = [...journal]
    .reverse()
    .find((e) => e.key.path === path && e.op.kind === 'attr' && e.op.name === 'style');
  const base = prior && prior.op.kind === 'attr' ? prior.op.value : attrOf(node, 'style');
  const value = mergeStyle(base, updates);
  return addToJournal(
    journal,
    entry(session, path, { kind: 'attr', name: 'style', value }, '서식'),
  );
}

/* ---- Output ---- */

export interface BuildOutput {
  text: string;
  bytes: Uint8Array;
  conflicts: PatchConflict[];
}

function normalizeCharset(full: string): string {
  const shrunk = shrinkBlobs(full);
  const source = shrunk.text;
  const root = parseSource(source);
  const html = elementChildren(root).find((n) => n.tagName === 'html');
  const head = html && elementChildren(html).find((n) => n.tagName === 'head');
  for (const meta of head ? elementChildren(head) : []) {
    if (meta.tagName !== 'meta') continue;
    const loc = meta.sourceCodeLocation?.attrs;
    if (loc?.charset) {
      return shrunk.expand(
        `${source.slice(0, loc.charset.startOffset)}charset="utf-8"${source.slice(loc.charset.endOffset)}`,
      );
    }
    if (loc?.content && /charset/i.test(attrOf(meta, 'content') ?? '')) {
      return shrunk.expand(
        `${source.slice(0, loc.content.startOffset)}content="text/html; charset=utf-8"${source.slice(loc.content.endOffset)}`,
      );
    }
  }
  return full;
}

function encodeOutput(text: string, hasBom: boolean): Uint8Array {
  const body = new TextEncoder().encode(text);
  if (!hasBom) return body;
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf]);
  out.set(body, 3);
  return out;
}

export interface SaveOptions {
  /** Keep original + journal inside the file for restore and further edits. Default true. */
  keepHistory?: boolean;
  journal?: JournalEntry[];
  slides?: string[];
}

export async function buildSavedHtml(
  session: LegacySession,
  opts: SaveOptions = {},
): Promise<BuildOutput> {
  const journal = opts.journal ?? session.journal;
  const applied = applyJournal(session.index, journal);
  let text = applied.output;
  if (session.encoding !== 'utf-8') text = normalizeCharset(text);
  if (opts.keepHistory !== false && (journal.length > 0 || session.restoredFromSidecar)) {
    const state: Sidecar = {
      v: SIDECAR_VERSION,
      original: await compressText(session.source),
      encoding: session.encoding,
      hasBom: session.hasBom,
      fileName: session.originalFileName,
      journal,
      slides: opts.slides ?? session.slides,
      outputHash: anchorHash(text),
    };
    const block = `<script type="application/json" id="${SIDECAR_ID}">${jsonForScriptTag(state)}</script>`;
    const at = sidecarInsertAt(text);
    text = text.slice(0, at) + block + text.slice(at);
  }
  return { text, bytes: encodeOutput(text, session.hasBom), conflicts: applied.conflicts };
}

/** Preview of the current state, for the sandboxed frame. */
export function previewFor(
  session: LegacySession,
  journal: JournalEntry[],
  opts: PreviewOptions = {},
): string {
  const { output } = applyJournal(session.index, journal);
  return buildPreview(output, opts).html;
}

/** The unedited original, for restore and comparison. */
export const originalPreview = (session: LegacySession, opts: PreviewOptions = {}): string =>
  buildPreview(session.source, opts).html;

/** Use a user-made slide division (ids from querying the preview frame). */
export function setSlides(session: LegacySession, ids: string[]): LegacySession {
  return { ...session, slides: ids, report: { ...session.report, slideCount: ids.length } };
}
