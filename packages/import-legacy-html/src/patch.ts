import { parseFragment } from 'parse5';
import { anchorHash, attrOf, type AstNode, INLINE_TAGS, type LegacyIndex } from './ast.js';

/**
 * Patch Journal (plan §3, ADR-007): edits are recorded against the original source and applied
 * as byte-range splices, so everything the user did not touch stays byte-identical.
 */
export interface PatchKey {
  /** Author-provided `data-deck-edit-id`, preferred when present. */
  editId?: string;
  /** Structural path from the document root. */
  path: string;
  /** Hash of the original text of the patched range; a mismatch means the target changed. */
  anchor: string;
}

export type PatchOp =
  | { kind: 'text'; text: string }
  | { kind: 'inner-html'; html: string }
  | { kind: 'attr'; name: string; value: string }
  | { kind: 'remove-attr'; name: string };

export interface JournalEntry {
  key: PatchKey;
  op: PatchOp;
  at: string;
  /** Text shown in change lists. */
  label?: string;
}

export interface PatchConflict {
  entry: JournalEntry;
  reason: 'target-missing' | 'anchor-mismatch' | 'overlap';
  message: string;
}

export interface ApplyResult {
  output: string;
  applied: JournalEntry[];
  conflicts: PatchConflict[];
}

export const escapeHtmlText = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\u00a0/g, '&nbsp;');

export const escapeHtmlAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface Range {
  start: number;
  end: number;
}

function innerRange(node: AstNode): Range | null {
  const l = node.sourceCodeLocation;
  if (!l?.startTag) return null;
  return { start: l.startTag.endOffset, end: l.endTag?.startOffset ?? l.endOffset };
}

function resolve(index: LegacyIndex, key: PatchKey): AstNode | null {
  const byAttr = key.editId ? index.byEditAttr.get(key.editId) : undefined;
  return index.byId.get(byAttr ?? key.path)?.node ?? null;
}

function targetRange(node: AstNode, op: PatchOp): Range | null {
  if (op.kind === 'text' || op.kind === 'inner-html') return innerRange(node);
  const attrLoc = node.sourceCodeLocation?.attrs?.[op.name];
  return attrLoc ? { start: attrLoc.startOffset, end: attrLoc.endOffset } : null;
}

/** Build the key for an edit, anchoring on the current source text of the affected range. */
export function makeKey(index: LegacyIndex, path: string, op: PatchOp): PatchKey {
  const node = index.byId.get(path)?.node;
  if (!node) throw new Error(`unknown node: ${path}`);
  const editId = attrOf(node, 'data-deck-edit-id');
  const range = targetRange(node, op);
  const anchor = anchorHash(range ? index.work.slice(range.start, range.end) : '');
  return { path, anchor, ...(editId ? { editId } : {}) };
}

function identity(entry: JournalEntry): string {
  const { op, key } = entry;
  const target = key.editId ?? key.path;
  return op.kind === 'attr' || op.kind === 'remove-attr'
    ? `${target}|attr|${op.name}`
    : `${target}|inner`;
}

/**
 * Add an edit. A later edit to the same target replaces the earlier one, and an edit to an
 * element's inner content absorbs earlier edits inside it (their result is already in the new
 * content). Returns a new array so undo can keep journal snapshots.
 */
export function addToJournal(journal: JournalEntry[], entry: JournalEntry): JournalEntry[] {
  const id = identity(entry);
  const isInner = entry.op.kind === 'text' || entry.op.kind === 'inner-html';
  const prefix = `${entry.key.path}/`;
  return [
    ...journal.filter((e) => {
      if (identity(e) === id) return false;
      if (isInner && e.key.path.startsWith(prefix)) return false;
      return true;
    }),
    entry,
  ];
}

interface Splice extends Range {
  text: string;
}

/** Apply a journal to the original source. Never guesses: anything uncertain becomes a conflict. */
export function applyJournal(index: LegacyIndex, journal: JournalEntry[]): ApplyResult {
  const source = index.work;
  const splices: (Splice & { entry: JournalEntry })[] = [];
  const conflicts: PatchConflict[] = [];

  for (const entry of journal) {
    const node = resolve(index, entry.key);
    if (!node) {
      conflicts.push({
        entry,
        reason: 'target-missing',
        message: `수정 대상을 찾을 수 없습니다 (${entry.label ?? entry.key.path}).`,
      });
      continue;
    }
    const { op } = entry;
    const range = targetRange(node, op);
    const currentAnchor = anchorHash(range ? source.slice(range.start, range.end) : '');
    if (currentAnchor !== entry.key.anchor) {
      conflicts.push({
        entry,
        reason: 'anchor-mismatch',
        message: `원본이 달라져 적용하지 않았습니다 (${entry.label ?? entry.key.path}).`,
      });
      continue;
    }
    switch (op.kind) {
      case 'text':
      case 'inner-html': {
        if (!range) {
          conflicts.push({
            entry,
            reason: 'target-missing',
            message: '내용 범위를 찾을 수 없습니다.',
          });
          break;
        }
        const text = op.kind === 'text' ? escapeHtmlText(op.text) : sanitizeInlineHtml(op.html);
        splices.push({ ...range, text, entry });
        break;
      }
      case 'attr': {
        const rendered = `${op.name}="${escapeHtmlAttr(op.value)}"`;
        if (range) splices.push({ ...range, text: rendered, entry });
        else {
          const start = node.sourceCodeLocation!.startTag?.startOffset;
          if (start === undefined) {
            conflicts.push({
              entry,
              reason: 'target-missing',
              message: '시작 태그를 찾을 수 없습니다.',
            });
            break;
          }
          const at = start + 1 + node.tagName!.length;
          splices.push({ start: at, end: at, text: ` ${rendered}`, entry });
        }
        break;
      }
      case 'remove-attr': {
        if (!range) break; // Nothing to remove: already absent.
        let start = range.start;
        while (start > 0 && /\s/.test(source[start - 1]!)) start--;
        splices.push({ start, end: range.end, text: '', entry });
        break;
      }
    }
  }

  splices.sort((a, b) => a.start - b.start || a.end - b.end);
  const accepted: typeof splices = [];
  for (const s of splices) {
    const prev = accepted[accepted.length - 1];
    if (prev && s.start < prev.end) {
      conflicts.push({
        entry: s.entry,
        reason: 'overlap',
        message: `다른 수정과 겹쳐 적용하지 않았습니다 (${s.entry.label ?? s.entry.key.path}).`,
      });
      continue;
    }
    accepted.push(s);
  }

  const parts: string[] = [];
  let cursor = 0;
  for (const s of accepted) {
    parts.push(source.slice(cursor, s.start), s.text);
    cursor = s.end;
  }
  parts.push(source.slice(cursor));
  return { output: index.expand(parts.join('')), applied: accepted.map((s) => s.entry), conflicts };
}

/* ---- Inline sanitiser: the only route for edited markup back into a saved file. ---- */

const INLINE_ATTRS = new Set([
  'class',
  'style',
  'href',
  'title',
  'lang',
  'dir',
  'datetime',
  'color',
  'face',
  'size',
]);
const SAFE_HREF = /^(?:https?:|mailto:|tel:|#|\/|\.{0,2}\/|[^:]*$)/i;
const SAFE_STYLE = /expression\s*\(|url\s*\(|@import|behavior\s*:|-moz-binding|javascript:/i;

function serializeInline(node: AstNode): string {
  if (node.nodeName === '#text') return escapeHtmlText(node.value ?? '');
  if (node.nodeName === '#comment') return '';
  const tag = node.tagName?.toLowerCase();
  const children = (node.childNodes ?? []).map(serializeInline).join('');
  if (!tag) return children;
  if (!INLINE_TAGS.has(tag)) return tag === 'div' || tag === 'p' ? `${children}<br>` : children;
  if (tag === 'br' || tag === 'wbr') return `<${tag}>`;
  const attrs = (node.attrs ?? [])
    .filter((a) => {
      const name = a.name.toLowerCase();
      if (!INLINE_ATTRS.has(name)) return false;
      if (name === 'href') {
        return SAFE_HREF.test(a.value.replace(/[\u0000- ]+/g, ''));
      }
      if (name === 'style') return !SAFE_STYLE.test(a.value);
      return true;
    })
    .map((a) => ` ${a.name}="${escapeHtmlAttr(a.value)}"`)
    .join('');
  return `<${tag}${attrs}>${children}</${tag}>`;
}

/**
 * Reduce markup coming out of contentEditable to inline text formatting. Scripts, handlers, and
 * unknown tags are dropped, so a poisoned clipboard paste cannot reach the saved file.
 */
export function sanitizeInlineHtml(html: string): string {
  const frag = parseFragment(html) as unknown as AstNode;
  const out = (frag.childNodes ?? []).map(serializeInline).join('');
  return out.replace(/(?:<br>)+$/, '');
}

/** Merge CSS declarations into an existing style attribute, keeping unrelated declarations and order. */
export function mergeStyle(
  existing: string | undefined,
  updates: Record<string, string | null>,
): string {
  const decls = new Map<string, string>();
  for (const part of (existing ?? '').split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const name = part.slice(0, i).trim().toLowerCase();
    if (name) decls.set(name, part.slice(i + 1).trim());
  }
  for (const [name, value] of Object.entries(updates)) {
    const key = name.toLowerCase();
    if (value === null) decls.delete(key);
    else decls.set(key, value);
  }
  return [...decls].map(([k, v]) => `${k}: ${v}`).join('; ');
}
