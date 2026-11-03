import { openDB, type IDBPDatabase } from 'idb';
import { assetIdFor, type AssetMeta, type DeckDocument } from '@hps/document-core';
import { scanImageFile, type Finding, type ImageKind } from '@hps/security-scan';

export const LIMITS = {
  maxImageBytes: 50 * 1024 * 1024,
  /** Decoded pixels; a tiny file can still decode into gigabytes of memory. */
  maxImagePixels: 100_000_000,
};

const MIME: Record<ImageKind, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

export function dataUrlToBytes(url: string): { bytes: Uint8Array; mime: string } {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (!m) throw new Error('base64 data URL이 아닙니다.');
  return { mime: m[1]!, bytes: Uint8Array.from(atob(m[2]!), (c) => c.charCodeAt(0)) };
}

export interface PreparedAsset {
  id: string;
  dataUrl: string;
  meta: AssetMeta;
  findings: Finding[];
}

export class AssetRejectedError extends Error {
  constructor(
    message: string,
    readonly findings: Finding[] = [],
  ) {
    super(message);
    this.name = 'AssetRejectedError';
  }
}

export interface PrepareOptions {
  name?: string;
  declaredMime?: string;
  /** Browser image decode. Throw if the file is not really decodable. */
  decode?: (dataUrl: string) => Promise<{ width: number; height: number }>;
  /** Reduce an SVG to a safe subset before storing it. */
  sanitizeSvg?: (svg: string) => string;
}

/**
 * Entry point for every image entering a deck: content sniffing and scanning first, the file's
 * name and declared type never decide anything.
 */
export async function prepareImage(
  input: Uint8Array,
  opts: PrepareOptions = {},
): Promise<PreparedAsset> {
  if (input.length > LIMITS.maxImageBytes) {
    throw new AssetRejectedError(
      `이미지가 너무 큽니다(최대 ${LIMITS.maxImageBytes / 1024 / 1024}MB).`,
    );
  }
  const scan = scanImageFile(input, opts.declaredMime ? { declaredMime: opts.declaredMime } : {});
  if (!scan.ok || !scan.kind) {
    throw new AssetRejectedError(
      scan.findings[0]?.title ?? '지원하지 않는 이미지입니다.',
      scan.findings,
    );
  }
  const kind = scan.kind as ImageKind;
  let bytes = input;
  if (kind === 'svg') {
    const text = new TextDecoder().decode(input);
    if (!opts.sanitizeSvg)
      throw new AssetRejectedError('SVG 정화 기능 없이는 SVG를 넣을 수 없습니다.');
    const clean = opts.sanitizeSvg(text);
    if (!clean.trim()) throw new AssetRejectedError('SVG 내용을 정화한 뒤 남은 것이 없습니다.');
    bytes = new TextEncoder().encode(clean);
  }
  const mime = MIME[kind];
  const dataUrl = bytesToDataUrl(bytes, mime);
  let size: { width: number; height: number } | undefined;
  if (opts.decode) {
    try {
      size = await opts.decode(dataUrl);
    } catch {
      throw new AssetRejectedError('이미지를 읽을 수 없습니다. 손상된 파일일 수 있습니다.');
    }
    if (size.width * size.height > LIMITS.maxImagePixels) {
      throw new AssetRejectedError(`이미지 해상도가 너무 높습니다(${size.width}×${size.height}).`);
    }
  }
  return {
    id: await assetIdFor(bytes as BufferSource),
    dataUrl,
    findings: scan.findings,
    meta: {
      kind: kind === 'svg' ? 'svg' : 'image',
      mime,
      size: bytes.length,
      source: 'embedded',
      ...(opts.name ? { name: opts.name.slice(0, 300) } : {}),
      ...(size ? { width: size.width, height: size.height } : {}),
    },
  };
}

/* ---- Local persistence: never promised as permanent (plan §5). ---- */

export interface StoredSnapshot {
  key: string;
  docId: string;
  savedAt: number;
  title: string;
  doc: DeckDocument;
  reason: 'auto' | 'manual';
}

export interface StoredLegacy {
  key: string;
  fileName: string;
  bytes: Uint8Array;
  changes: number;
  savedAt: number;
}

const DB_NAME = 'hps-editor';
const MAX_SNAPSHOTS_PER_DOC = 20;

export type PersistErrorKind = 'quota' | 'unavailable' | 'other';

export class PersistError extends Error {
  constructor(
    readonly kind: PersistErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'PersistError';
  }
}

function classify(e: unknown): PersistError {
  const name = (e as { name?: string })?.name;
  if (name === 'QuotaExceededError')
    return new PersistError('quota', '브라우저 저장 공간이 가득 찼습니다. 파일로 저장하세요.');
  if (name === 'InvalidStateError' || name === 'SecurityError' || name === 'UnknownError') {
    return new PersistError(
      'unavailable',
      '브라우저 저장소를 사용할 수 없습니다(사생활 보호 모드 등). 파일로 저장하세요.',
    );
  }
  return new PersistError('other', `자동 저장 실패: ${(e as Error)?.message ?? String(e)}`);
}

export class LocalStore {
  private dbPromise: Promise<IDBPDatabase> | null = null;

  private db(): Promise<IDBPDatabase> {
    this.dbPromise ??= openDB(DB_NAME, 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const snapshots = db.createObjectStore('snapshots', { keyPath: 'key' });
          snapshots.createIndex('byDoc', 'docId');
          snapshots.createIndex('bySavedAt', 'savedAt');
          db.createObjectStore('assets');
        }
        if (oldVersion < 2) db.createObjectStore('legacy', { keyPath: 'key' });
      },
    });
    return this.dbPromise;
  }

  async saveSnapshot(
    doc: DeckDocument,
    assets: Map<string, string>,
    reason: StoredSnapshot['reason'],
  ): Promise<void> {
    try {
      const db = await this.db();
      const tx = db.transaction(['snapshots', 'assets'], 'readwrite');
      const savedAt = Date.now();
      await tx.objectStore('snapshots').put({
        key: `${doc.docId}:${savedAt}`,
        docId: doc.docId,
        savedAt,
        title: doc.meta.title,
        doc,
        reason,
      } satisfies StoredSnapshot);
      const store = tx.objectStore('assets');
      for (const [id, url] of assets) {
        if (!(await store.getKey(id))) await store.put(url, id);
      }
      await tx.done;
      await this.prune(doc.docId);
    } catch (e) {
      throw classify(e);
    }
  }

  private async prune(docId: string): Promise<void> {
    const db = await this.db();
    const keys = (await db.getAllKeysFromIndex('snapshots', 'byDoc', docId)) as string[];
    const sorted = keys.sort((a, b) => Number(a.split(':').pop()) - Number(b.split(':').pop()));
    const excess = sorted.slice(0, Math.max(0, sorted.length - MAX_SNAPSHOTS_PER_DOC));
    if (excess.length) {
      const tx = db.transaction('snapshots', 'readwrite');
      await Promise.all(excess.map((k) => tx.store.delete(k)));
      await tx.done;
    }
  }

  /** Newest snapshot of each document, for the recovery list. */
  async latestSnapshots(): Promise<StoredSnapshot[]> {
    try {
      const db = await this.db();
      const all = (await db.getAll('snapshots')) as StoredSnapshot[];
      const newest = new Map<string, StoredSnapshot>();
      for (const s of all) {
        const cur = newest.get(s.docId);
        if (!cur || cur.savedAt < s.savedAt) newest.set(s.docId, s);
      }
      return [...newest.values()].sort((a, b) => b.savedAt - a.savedAt);
    } catch (e) {
      throw classify(e);
    }
  }

  async history(docId: string): Promise<StoredSnapshot[]> {
    try {
      const db = await this.db();
      const all = (await db.getAllFromIndex('snapshots', 'byDoc', docId)) as StoredSnapshot[];
      return all.sort((a, b) => b.savedAt - a.savedAt);
    } catch (e) {
      throw classify(e);
    }
  }

  async loadAssets(doc: DeckDocument): Promise<Map<string, string>> {
    const db = await this.db();
    const out = new Map<string, string>();
    for (const id of Object.keys(doc.assets)) {
      const url = (await db.get('assets', id)) as string | undefined;
      if (url) out.set(id, url);
    }
    return out;
  }

  /** An edited legacy file as it would be saved, sidecar included, so recovery is an ordinary open. */
  async saveLegacy(fileName: string, bytes: Uint8Array, changes: number): Promise<void> {
    try {
      const db = await this.db();
      await db.put('legacy', {
        key: fileName,
        fileName,
        bytes,
        changes,
        savedAt: Date.now(),
      } satisfies StoredLegacy);
    } catch (e) {
      throw classify(e);
    }
  }

  async listLegacy(): Promise<StoredLegacy[]> {
    try {
      const db = await this.db();
      const all = (await db.getAll('legacy')) as StoredLegacy[];
      return all.sort((a, b) => b.savedAt - a.savedAt);
    } catch (e) {
      throw classify(e);
    }
  }

  async deleteLegacy(key: string): Promise<void> {
    const db = await this.db();
    await db.delete('legacy', key);
  }

  async deleteDoc(docId: string): Promise<void> {
    const db = await this.db();
    const keys = (await db.getAllKeysFromIndex('snapshots', 'byDoc', docId)) as string[];
    const tx = db.transaction('snapshots', 'readwrite');
    await Promise.all(keys.map((k) => tx.store.delete(k)));
    await tx.done;
  }
}

/* ---- Saving files ---- */

export type SaveOutcome =
  | { status: 'saved'; via: 'picker'; name: string; handle: FileSystemFileHandle }
  | { status: 'saved'; via: 'existing-handle'; name: string; handle: FileSystemFileHandle }
  | { status: 'downloaded'; name: string }
  | { status: 'cancelled' }
  | { status: 'failed'; reason: 'permission' | 'quota' | 'other'; message: string };

interface PickerAccept {
  description: string;
  accept: Record<string, string[]>;
}
type PickerWindow = Window & {
  showSaveFilePicker?: (o: {
    suggestedName?: string;
    types?: PickerAccept[];
  }) => Promise<FileSystemFileHandle>;
};
type WritableHandle = FileSystemFileHandle & {
  queryPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
};

function failure(e: unknown): SaveOutcome {
  const name = (e as { name?: string })?.name;
  if (name === 'AbortError') return { status: 'cancelled' };
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      status: 'failed',
      reason: 'permission',
      message: '파일 쓰기 권한이 없습니다. 다른 이름으로 저장하세요.',
    };
  }
  if (name === 'QuotaExceededError') {
    return { status: 'failed', reason: 'quota', message: '디스크 공간이 부족합니다.' };
  }
  return {
    status: 'failed',
    reason: 'other',
    message: `저장 실패: ${(e as Error)?.message ?? String(e)}`,
  };
}

export function downloadBytes(bytes: Uint8Array, name: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Save As: the browser's own dialog asks before replacing a file. Falls back to a download. */
export async function saveAs(
  bytes: Uint8Array,
  name: string,
  mime: string,
  types: PickerAccept[],
): Promise<SaveOutcome> {
  const win = window as PickerWindow;
  if (!win.showSaveFilePicker) {
    downloadBytes(bytes, name, mime);
    return { status: 'downloaded', name };
  }
  try {
    const handle = await win.showSaveFilePicker({ suggestedName: name, types });
    const writable = await handle.createWritable();
    await writable.write(bytes as FileSystemWriteChunkType);
    await writable.close();
    return { status: 'saved', via: 'picker', name: handle.name, handle };
  } catch (e) {
    return failure(e);
  }
}

/** Overwrite a file the user already chose in this session. Callers confirm with the user first. */
export async function saveToHandle(
  handle: WritableHandle,
  bytes: Uint8Array,
): Promise<SaveOutcome> {
  try {
    const state = await handle.queryPermission?.({ mode: 'readwrite' });
    if (
      state !== 'granted' &&
      (await handle.requestPermission?.({ mode: 'readwrite' })) !== 'granted'
    ) {
      return {
        status: 'failed',
        reason: 'permission',
        message: '파일 쓰기 권한이 취소되었습니다. 다른 이름으로 저장하세요.',
      };
    }
    const writable = await handle.createWritable();
    await writable.write(bytes as FileSystemWriteChunkType);
    await writable.close();
    return { status: 'saved', via: 'existing-handle', name: handle.name, handle };
  } catch (e) {
    return failure(e);
  }
}

export const HTML_FILE_TYPES: PickerAccept[] = [
  { description: 'HTML 프레젠테이션', accept: { 'text/html': ['.html', '.htm'] } },
];
export const PPTX_FILE_TYPES: PickerAccept[] = [
  {
    description: 'PowerPoint',
    accept: {
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
    },
  },
];
export const ZIP_FILE_TYPES: PickerAccept[] = [
  { description: 'ZIP', accept: { 'application/zip': ['.zip'] } },
];
