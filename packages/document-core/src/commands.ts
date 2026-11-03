import { enablePatches, produceWithPatches, applyPatches, type Patch } from 'immer';
import { newId } from './ids.js';
import { createSlide } from './factory.js';
import type { AssetMeta, DeckDocument, Frame, Slide, SlideElement } from './schema.js';

enablePatches();

/** Deep-partial for element updates. Unknown fields are refused by re-validation at save. */
type ElementPatch = { [K: string]: unknown };

export type Command =
  | { type: 'element.add'; slideId: string; element: SlideElement; index?: number }
  | { type: 'element.update'; slideId: string; elementId: string; patch: ElementPatch }
  | { type: 'element.setFrames'; slideId: string; frames: Record<string, Partial<Frame>> }
  | { type: 'element.delete'; slideId: string; elementIds: string[] }
  | {
      type: 'element.reorder';
      slideId: string;
      elementIds: string[];
      to: 'front' | 'back' | 'forward' | 'backward';
    }
  | { type: 'element.group'; slideId: string; elementIds: string[] }
  | { type: 'element.ungroup'; slideId: string; elementIds: string[] }
  | { type: 'element.paste'; slideId: string; elements: SlideElement[]; offset?: number }
  | { type: 'slide.add'; index?: number; slide?: Slide }
  | { type: 'slide.delete'; slideId: string }
  | { type: 'slide.duplicate'; slideId: string }
  | { type: 'slide.move'; slideId: string; to: number }
  | {
      type: 'slide.update';
      slideId: string;
      patch: Partial<Pick<Slide, 'background' | 'notes' | 'section' | 'hidden'>>;
    }
  | { type: 'asset.add'; id: string; meta: AssetMeta }
  | { type: 'theme.update'; patch: Partial<DeckDocument['theme']> }
  | { type: 'meta.update'; patch: Partial<DeckDocument['meta']> };

export class CommandError extends Error {}

function slideOf(doc: DeckDocument, id: string): Slide {
  const slide = doc.slides.find((s) => s.id === id);
  if (!slide) throw new CommandError(`slide not found: ${id}`);
  return slide;
}

function deepMerge(target: Record<string, unknown>, patch: ElementPatch): void {
  for (const [key, value] of Object.entries(patch)) {
    const cur = target[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      cur &&
      typeof cur === 'object' &&
      !Array.isArray(cur) &&
      // Discriminated unions (fill, background) must be replaced whole, never blended.
      !('type' in (value as object))
    ) {
      deepMerge(cur as Record<string, unknown>, value as ElementPatch);
    } else if (value === undefined) {
      delete target[key];
    } else {
      target[key] = value;
    }
  }
}

function remapForCopy(elements: SlideElement[], offset: number): SlideElement[] {
  const groups = new Map<string, string>();
  return elements.map((el) => {
    const copy = structuredClone(el) as SlideElement;
    copy.id = newId('el');
    copy.frame = { ...copy.frame, x: copy.frame.x + offset, y: copy.frame.y + offset };
    if (copy.groupId) {
      if (!groups.has(copy.groupId)) groups.set(copy.groupId, newId('grp'));
      copy.groupId = groups.get(copy.groupId);
    }
    return copy;
  });
}

function normalizeZ(slide: Slide): void {
  slide.elements.sort((a, b) => a.zIndex - b.zIndex);
  slide.elements.forEach((el, i) => (el.zIndex = i));
}

function run(doc: DeckDocument, cmd: Command): void {
  switch (cmd.type) {
    case 'element.add': {
      const slide = slideOf(doc, cmd.slideId);
      const top = slide.elements.reduce((m, e) => Math.max(m, e.zIndex), -1);
      slide.elements.push({ ...cmd.element, zIndex: top + 1 });
      return;
    }
    case 'element.update': {
      const el = slideOf(doc, cmd.slideId).elements.find((e) => e.id === cmd.elementId);
      if (!el) throw new CommandError(`element not found: ${cmd.elementId}`);
      deepMerge(el as unknown as Record<string, unknown>, cmd.patch);
      return;
    }
    case 'element.setFrames': {
      const slide = slideOf(doc, cmd.slideId);
      for (const el of slide.elements) {
        const frame = cmd.frames[el.id];
        if (frame) Object.assign(el.frame, frame);
      }
      return;
    }
    case 'element.delete': {
      const slide = slideOf(doc, cmd.slideId);
      const ids = new Set(cmd.elementIds);
      slide.elements = slide.elements.filter((e) => !ids.has(e.id));
      return;
    }
    case 'element.reorder': {
      const slide = slideOf(doc, cmd.slideId);
      normalizeZ(slide);
      const ids = new Set(cmd.elementIds);
      const moving = slide.elements.filter((e) => ids.has(e.id));
      const rest = slide.elements.filter((e) => !ids.has(e.id));
      let next: SlideElement[];
      if (cmd.to === 'front') next = [...rest, ...moving];
      else if (cmd.to === 'back') next = [...moving, ...rest];
      else {
        next = [...slide.elements];
        const dir = cmd.to === 'forward' ? 1 : -1;
        const order = dir === 1 ? [...next.keys()].reverse() : [...next.keys()];
        for (const i of order) {
          const j = i + dir;
          const cur = next[i]!;
          const other = next[j];
          if (ids.has(cur.id) && other && !ids.has(other.id)) {
            next[i] = other;
            next[j] = cur;
          }
        }
      }
      slide.elements = next;
      slide.elements.forEach((el, i) => (el.zIndex = i));
      return;
    }
    case 'element.group': {
      const gid = newId('grp');
      for (const el of slideOf(doc, cmd.slideId).elements) {
        if (cmd.elementIds.includes(el.id)) el.groupId = gid;
      }
      return;
    }
    case 'element.ungroup': {
      for (const el of slideOf(doc, cmd.slideId).elements) {
        if (cmd.elementIds.includes(el.id)) delete el.groupId;
      }
      return;
    }
    case 'element.paste': {
      const slide = slideOf(doc, cmd.slideId);
      let top = slide.elements.reduce((m, e) => Math.max(m, e.zIndex), -1);
      for (const el of remapForCopy(cmd.elements, cmd.offset ?? 24)) {
        slide.elements.push({ ...el, zIndex: ++top });
      }
      return;
    }
    case 'slide.add': {
      const slide = cmd.slide ?? createSlide(doc.theme);
      doc.slides.splice(cmd.index ?? doc.slides.length, 0, slide);
      return;
    }
    case 'slide.delete': {
      if (doc.slides.length <= 1) throw new CommandError('마지막 슬라이드는 삭제할 수 없습니다.');
      slideOf(doc, cmd.slideId);
      doc.slides = doc.slides.filter((s) => s.id !== cmd.slideId);
      return;
    }
    case 'slide.duplicate': {
      const i = doc.slides.findIndex((s) => s.id === cmd.slideId);
      if (i < 0) throw new CommandError(`slide not found: ${cmd.slideId}`);
      const copy = JSON.parse(JSON.stringify(doc.slides[i])) as Slide;
      copy.id = newId('slide');
      copy.elements = remapForCopy(copy.elements, 0);
      doc.slides.splice(i + 1, 0, copy);
      return;
    }
    case 'slide.move': {
      const i = doc.slides.findIndex((s) => s.id === cmd.slideId);
      if (i < 0) throw new CommandError(`slide not found: ${cmd.slideId}`);
      const [slide] = doc.slides.splice(i, 1);
      const to = Math.max(0, Math.min(cmd.to, doc.slides.length));
      doc.slides.splice(to, 0, slide!);
      return;
    }
    case 'slide.update':
      Object.assign(slideOf(doc, cmd.slideId), cmd.patch);
      return;
    case 'asset.add':
      doc.assets[cmd.id] = cmd.meta;
      return;
    case 'theme.update':
      Object.assign(doc.theme, cmd.patch);
      return;
    case 'meta.update':
      Object.assign(doc.meta, cmd.patch);
      return;
  }
}

export interface CommandResult {
  doc: DeckDocument;
  patches: Patch[];
  inverse: Patch[];
}

export function applyCommands(doc: DeckDocument, cmds: Command[]): CommandResult {
  const [next, patches, inverse] = produceWithPatches(doc, (draft) => {
    for (const cmd of cmds) run(draft as DeckDocument, cmd);
  });
  return { doc: next, patches, inverse };
}

/* ---- History: undo stack of inverse patches. UI selection is a sidecar, not document state. ---- */

export interface HistoryEntry<S = unknown> {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  /** Merge key: consecutive entries with the same key collapse into one undo step (typing, nudging). */
  coalesceKey?: string;
  at: number;
  selectionBefore?: S;
  selectionAfter?: S;
}

export interface History<S = unknown> {
  past: HistoryEntry<S>[];
  future: HistoryEntry<S>[];
}

export const emptyHistory = <S = unknown>(): History<S> => ({ past: [], future: [] });

const COALESCE_WINDOW_MS = 1200;
const HISTORY_LIMIT = 500;

export function pushHistory<S>(history: History<S>, entry: HistoryEntry<S>): History<S> {
  const last = history.past[history.past.length - 1];
  if (
    last &&
    entry.coalesceKey &&
    last.coalesceKey === entry.coalesceKey &&
    entry.at - last.at < COALESCE_WINDOW_MS
  ) {
    const merged: HistoryEntry<S> = {
      ...last,
      patches: [...last.patches, ...entry.patches],
      inverse: [...entry.inverse, ...last.inverse],
      at: entry.at,
      selectionAfter: entry.selectionAfter,
    };
    return { past: [...history.past.slice(0, -1), merged], future: [] };
  }
  return { past: [...history.past, entry].slice(-HISTORY_LIMIT), future: [] };
}

export function undo<S>(
  doc: DeckDocument,
  history: History<S>,
): { doc: DeckDocument; history: History<S>; entry: HistoryEntry<S> } | null {
  const entry = history.past[history.past.length - 1];
  if (!entry) return null;
  return {
    doc: applyPatches(doc, entry.inverse),
    entry,
    history: { past: history.past.slice(0, -1), future: [entry, ...history.future] },
  };
}

export function redo<S>(
  doc: DeckDocument,
  history: History<S>,
): { doc: DeckDocument; history: History<S>; entry: HistoryEntry<S> } | null {
  const entry = history.future[0];
  if (!entry) return null;
  return {
    doc: applyPatches(doc, entry.patches),
    entry,
    history: { past: [...history.past, entry], future: history.future.slice(1) },
  };
}
