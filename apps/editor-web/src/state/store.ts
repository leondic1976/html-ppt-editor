import { create } from 'zustand';
import {
  applyCommands,
  CommandError,
  emptyHistory,
  pushHistory,
  redo as redoDoc,
  undo as undoDoc,
  type Command,
  type DeckDocument,
  type History,
} from '@hps/document-core';
import { LocalStore, PersistError } from '@hps/asset-manager';
import {
  buildSavedHtml,
  type ImportWarning,
  type JournalEntry,
  type LegacySession,
} from '@hps/import-legacy-html';
import type { ExportReport } from '@hps/export-report';
import type { ScanReport } from '@hps/security-scan';
import { setLocale, type Locale } from '@hps/design-system';

export const localStore = new LocalStore();

export type Selection = string[];

export interface Notice {
  id: number;
  kind: 'info' | 'success' | 'warning' | 'error';
  text: string;
}

export interface NativeState {
  kind: 'native';
  doc: DeckDocument;
  assets: Map<string, string>;
  history: History<Selection>;
  slideIndex: number;
  selection: Selection;
  editingId: string | null;
  fileHandle: FileSystemFileHandle | null;
  warnings: string[];
}

export interface LegacyState {
  kind: 'legacy';
  session: LegacySession;
  journal: JournalEntry[];
  undo: JournalEntry[][];
  redo: JournalEntry[][];
  slideIndex: number;
  selectedId: string | null;
  allowExternal: boolean;
  localAssets: Map<string, string>;
  fileHandle: FileSystemFileHandle | null;
  /** Bumped when the frame must rebuild from the journal (undo, opt-ins). */
  frameVersion: number;
  compare: boolean;
  warnings: ImportWarning[];
}

export type Dialog =
  | { type: 'scan'; report: ScanReport; bytes: Uint8Array; decide?: boolean }
  | { type: 'import-report' }
  | { type: 'export-report'; report: ExportReport }
  | { type: 'history' }
  | { type: 'fonts' }
  | { type: 'slides-selector' }
  | { type: 'confirm-overwrite'; name: string; changes: number }
  | { type: 'conversion'; title: string; lines: string[] }
  | { type: 'templates' };

export interface AppState {
  mode: NativeState | LegacyState | null;
  dirty: boolean;
  savedAt: number | null;
  autosave: { status: 'idle' | 'saving' | 'saved' | 'error'; message?: string };
  zoom: number | null;
  showSafeArea: boolean;
  showGrid: boolean;
  dark: boolean;
  locale: Locale;
  presenting: { startAt: number } | null;
  dialog: Dialog | null;
  notices: Notice[];
  lastScan: ScanReport | null;
  busy: string | null;

  notify(kind: Notice['kind'], text: string): void;
  dismiss(id: number): void;
  openNative(
    doc: DeckDocument,
    assets: Map<string, string>,
    opts?: { warnings?: string[]; handle?: FileSystemFileHandle | null },
  ): void;
  openLegacy(session: LegacySession, localAssets?: Map<string, string>): void;
  closeDocument(): void;
  commit(cmds: Command[], label: string, coalesceKey?: string): boolean;
  undo(): void;
  redo(): void;
  addAsset(
    id: string,
    url: string,
    meta: Parameters<typeof applyCommands>[1][number] & { type: 'asset.add' },
  ): void;
  setSlide(index: number): void;
  setSelection(ids: Selection): void;
  setEditing(id: string | null): void;
  legacyCommit(next: JournalEntry[], opts?: { rebuild?: boolean }): void;
  legacyUndo(): void;
  legacyRedo(): void;
  patchLegacy(patch: Partial<LegacyState>): void;
  setDialog(d: Dialog | null): void;
  setZoom(z: number | null): void;
  toggle(key: 'showSafeArea' | 'showGrid'): void;
  setDark(v: boolean): void;
  setLanguage(l: Locale): void;
  setPresenting(p: { startAt: number } | null): void;
  markSaved(handle?: FileSystemFileHandle | null): void;
  setBusy(text: string | null): void;
  setLastScan(r: ScanReport | null): void;
}

let noticeId = 1;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
const AUTOSAVE_DELAY_MS = 2500;

function scheduleAutosave(get: () => AppState, set: (p: Partial<AppState>) => void): void {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    const { mode } = get();
    if (!mode) return;
    set({ autosave: { status: 'saving' } });
    const saving =
      mode.kind === 'native'
        ? localStore.saveSnapshot(mode.doc, mode.assets, 'auto')
        : buildSavedHtml(mode.session, { journal: mode.journal, slides: mode.session.slides }).then(
            (out) =>
              // A save or close while this was being built means the recovery copy is no longer wanted.
              get().dirty
                ? localStore.saveLegacy(mode.session.fileName, out.bytes, mode.journal.length)
                : undefined,
          );
    saving
      .then(() => set({ autosave: { status: 'saved' } }))
      .catch((e: unknown) => {
        const message = e instanceof PersistError ? e.message : '자동 저장에 실패했습니다.';
        set({ autosave: { status: 'error', message } });
        get().notify('warning', `${message} 작업 내용을 파일로 저장하세요.`);
      });
  }, AUTOSAVE_DELAY_MS);
}

function prefersDark(): boolean {
  try {
    const saved = localStorage.getItem('hps-dark');
    if (saved !== null) return saved === '1';
  } catch {
    /* Storage can be blocked; the system preference still applies. */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function savedLocale(): Locale {
  try {
    if (localStorage.getItem('hps-locale') === 'en') return 'en';
  } catch {
    /* Storage can be blocked. */
  }
  return 'ko';
}

const initialLocale = savedLocale();
setLocale(initialLocale);

export const useApp = create<AppState>((set, get) => ({
  mode: null,
  dirty: false,
  savedAt: null,
  autosave: { status: 'idle' },
  zoom: null,
  showSafeArea: false,
  showGrid: false,
  dark: prefersDark(),
  locale: initialLocale,
  presenting: null,
  dialog: null,
  notices: [],
  lastScan: null,
  busy: null,

  notify(kind, text) {
    const id = noticeId++;
    set((s) => ({ notices: [...s.notices.slice(-3), { id, kind, text }] }));
    if (kind !== 'error') setTimeout(() => get().dismiss(id), kind === 'warning' ? 9000 : 4500);
  },
  dismiss(id) {
    set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
  },

  openNative(doc, assets, opts = {}) {
    set({
      mode: {
        kind: 'native',
        doc,
        assets,
        history: emptyHistory<Selection>(),
        slideIndex: 0,
        selection: [],
        editingId: null,
        fileHandle: opts.handle ?? null,
        warnings: opts.warnings ?? [],
      },
      dirty: false,
      savedAt: null,
      zoom: null,
      autosave: { status: 'idle' },
    });
  },

  openLegacy(session, localAssets = new Map()) {
    set({
      mode: {
        kind: 'legacy',
        session,
        journal: session.journal,
        undo: [],
        redo: [],
        slideIndex: 0,
        selectedId: null,
        allowExternal: false,
        localAssets,
        fileHandle: null,
        frameVersion: 0,
        compare: false,
        warnings: session.report.warnings,
      },
      dirty: false,
      savedAt: null,
      zoom: null,
      autosave: { status: 'idle' },
    });
  },

  closeDocument() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    const { mode } = get();
    if (mode?.kind === 'legacy')
      void localStore.deleteLegacy(mode.session.fileName).catch(() => undefined);
    set({ mode: null, dirty: false, dialog: null, presenting: null, lastScan: null });
  },

  commit(cmds, label, coalesceKey) {
    const { mode } = get();
    if (!mode || mode.kind !== 'native') return false;
    try {
      const r = applyCommands(mode.doc, cmds);
      const history = pushHistory(mode.history, {
        label,
        patches: r.patches,
        inverse: r.inverse,
        at: Date.now(),
        selectionBefore: mode.selection,
        selectionAfter: mode.selection,
        ...(coalesceKey ? { coalesceKey } : {}),
      });
      const slideIndex = Math.min(mode.slideIndex, r.doc.slides.length - 1);
      set({ mode: { ...mode, doc: r.doc, history, slideIndex }, dirty: true });
      scheduleAutosave(get, set);
      return true;
    } catch (e) {
      if (e instanceof CommandError) get().notify('warning', e.message);
      else throw e;
      return false;
    }
  },

  undo() {
    const { mode } = get();
    if (!mode) return;
    if (mode.kind === 'legacy') return get().legacyUndo();
    const r = undoDoc(mode.doc, mode.history);
    if (!r) return;
    const slideIndex = Math.min(mode.slideIndex, r.doc.slides.length - 1);
    set({
      mode: {
        ...mode,
        doc: r.doc,
        history: r.history,
        selection: r.entry.selectionBefore ?? [],
        slideIndex,
        editingId: null,
      },
      dirty: true,
    });
    scheduleAutosave(get, set);
  },

  redo() {
    const { mode } = get();
    if (!mode) return;
    if (mode.kind === 'legacy') return get().legacyRedo();
    const r = redoDoc(mode.doc, mode.history);
    if (!r) return;
    const slideIndex = Math.min(mode.slideIndex, r.doc.slides.length - 1);
    set({
      mode: {
        ...mode,
        doc: r.doc,
        history: r.history,
        selection: r.entry.selectionAfter ?? [],
        slideIndex,
        editingId: null,
      },
      dirty: true,
    });
    scheduleAutosave(get, set);
  },

  addAsset(id, url, cmd) {
    const { mode } = get();
    if (!mode || mode.kind !== 'native') return;
    mode.assets.set(id, url);
    get().commit([cmd], '자산 추가');
  },

  setSlide(index) {
    const { mode } = get();
    if (!mode) return;
    if (mode.kind === 'native') {
      const i = Math.max(0, Math.min(mode.doc.slides.length - 1, index));
      set({ mode: { ...mode, slideIndex: i, selection: [], editingId: null } });
    } else {
      const i = Math.max(0, Math.min(Math.max(0, mode.session.slides.length - 1), index));
      set({ mode: { ...mode, slideIndex: i, selectedId: null } });
    }
  },

  setSelection(ids) {
    const { mode } = get();
    if (mode?.kind === 'native') set({ mode: { ...mode, selection: ids } });
  },
  setEditing(id) {
    const { mode } = get();
    if (mode?.kind === 'native') set({ mode: { ...mode, editingId: id } });
  },

  legacyCommit(next, opts = {}) {
    const { mode } = get();
    if (!mode || mode.kind !== 'legacy') return;
    set({
      mode: {
        ...mode,
        journal: next,
        undo: [...mode.undo, mode.journal].slice(-200),
        redo: [],
        frameVersion: opts.rebuild ? mode.frameVersion + 1 : mode.frameVersion,
      },
      dirty: true,
    });
    scheduleAutosave(get, set);
  },
  legacyUndo() {
    const { mode } = get();
    if (!mode || mode.kind !== 'legacy' || !mode.undo.length) return;
    set({
      mode: {
        ...mode,
        journal: mode.undo[mode.undo.length - 1]!,
        undo: mode.undo.slice(0, -1),
        redo: [mode.journal, ...mode.redo],
        frameVersion: mode.frameVersion + 1,
      },
      dirty: true,
    });
    scheduleAutosave(get, set);
  },
  legacyRedo() {
    const { mode } = get();
    if (!mode || mode.kind !== 'legacy' || !mode.redo.length) return;
    set({
      mode: {
        ...mode,
        journal: mode.redo[0]!,
        redo: mode.redo.slice(1),
        undo: [...mode.undo, mode.journal],
        frameVersion: mode.frameVersion + 1,
      },
      dirty: true,
    });
    scheduleAutosave(get, set);
  },
  patchLegacy(patch) {
    const { mode } = get();
    if (mode?.kind === 'legacy') set({ mode: { ...mode, ...patch } });
  },

  setDialog: (dialog) => set({ dialog }),
  setZoom: (zoom) => set({ zoom }),
  toggle: (key) => set((s) => ({ [key]: !s[key] }) as Partial<AppState>),
  setDark(dark) {
    try {
      localStorage.setItem('hps-dark', dark ? '1' : '0');
    } catch {
      /* Convenience only. */
    }
    set({ dark });
  },
  setLanguage(locale) {
    setLocale(locale);
    try {
      localStorage.setItem('hps-locale', locale);
    } catch {
      /* Convenience only. */
    }
    set({ locale });
  },
  setPresenting: (presenting) => set({ presenting }),
  markSaved(handle) {
    const { mode } = get();
    // The file on disk now holds these edits, so the recovery copy has served its purpose.
    if (mode?.kind === 'legacy') {
      if (autosaveTimer) clearTimeout(autosaveTimer);
      void localStore.deleteLegacy(mode.session.fileName).catch(() => undefined);
    }
    const patch: Partial<AppState> = { dirty: false, savedAt: Date.now() };
    if (mode && handle !== undefined) patch.mode = { ...mode, fileHandle: handle };
    set(patch);
  },
  setBusy: (busy) => set({ busy }),
  setLastScan: (lastScan) => set({ lastScan }),
}));
