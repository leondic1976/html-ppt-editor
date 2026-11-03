import { parse } from 'parse5';
import { shrinkBlobs } from '@hps/security-scan';

/** Loose view of parse5 nodes; only the fields this package reads. */
export interface AstLocation {
  startOffset: number;
  endOffset: number;
  startLine: number;
  startCol: number;
  startTag?: { startOffset: number; endOffset: number };
  endTag?: { startOffset: number; endOffset: number };
  attrs?: Record<string, { startOffset: number; endOffset: number }>;
}
export interface AstNode {
  nodeName: string;
  tagName?: string;
  value?: string;
  data?: string;
  attrs?: { name: string; value: string; prefix?: string }[];
  namespaceURI?: string;
  childNodes?: AstNode[];
  content?: AstNode;
  parentNode?: AstNode | null;
  sourceCodeLocation?: AstLocation | null;
}

export const parseSource = (source: string): AstNode =>
  parse(source, { sourceCodeLocationInfo: true }) as unknown as AstNode;

export const attrOf = (node: AstNode, name: string): string | undefined =>
  node.attrs?.find((a) => a.name === name)?.value;

export const classesOf = (node: AstNode): string[] =>
  (attrOf(node, 'class') ?? '').split(/\s+/).filter(Boolean);

export const isElement = (node: AstNode): boolean => typeof node.tagName === 'string';

export const elementChildren = (node: AstNode): AstNode[] =>
  (node.childNodes ?? []).filter(isElement);

/** cyrb53: fast, non-cryptographic anchor hash. Detects drift only; it is not a security control. */
export function anchorHash(s: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function collectText(node: AstNode): string {
  if (node.nodeName === '#text') return node.value ?? '';
  return (node.childNodes ?? []).map(collectText).join('');
}

export const INLINE_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'br',
  'cite',
  'code',
  'data',
  'del',
  'dfn',
  'em',
  'font',
  'i',
  'ins',
  'kbd',
  'mark',
  'q',
  's',
  'samp',
  'small',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'time',
  'tspan',
  'u',
  'var',
  'wbr',
]);

const NEVER_EDIT = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'title',
  'textarea',
  'select',
  'option',
  'iframe',
  'object',
  'embed',
  'canvas',
  'video',
  'audio',
  'head',
  'meta',
  'link',
  'math',
]);

/**
 * Structural key: element-child indexes from the document root, e.g. "1/1/0/2".
 * Stable across re-parses of the same bytes and survives edits outside the subtree.
 */
export interface IndexedNode {
  id: string;
  node: AstNode;
  tag: string;
  parentId: string | null;
}

export interface EditableText {
  id: string;
  /** Plain text at parse time. */
  text: string;
  /** True when the block has inline children; edits then replace inner markup. */
  hasInlineChildren: boolean;
}

export interface EditableImage {
  id: string;
  kind: 'img' | 'svg-image' | 'inline-bg';
  src: string;
}

export interface LegacyIndex {
  /** The text all ranges refer to: the source with large base64 runs tokenised. */
  work: string;
  /** Restores tokens in anything derived from `work`. */
  expand(derived: string): string;
  root: AstNode;
  byId: Map<string, IndexedNode>;
  byEditAttr: Map<string, string>;
  texts: Map<string, EditableText>;
  images: Map<string, EditableImage>;
  head: AstNode | null;
  body: AstNode | null;
}

function isInlineOnly(node: AstNode): boolean {
  for (const c of node.childNodes ?? []) {
    if (c.nodeName === '#text' || c.nodeName === '#comment') continue;
    const tag = c.tagName?.toLowerCase();
    if (!tag || !INLINE_TAGS.has(tag) || !isInlineOnly(c)) return false;
  }
  return true;
}

const hasOwnText = (node: AstNode): boolean => collectText(node).trim().length > 0;

const INLINE_BG = /background(?:-image)?\s*:[^;]*url\(/i;

export function indexDocument(source: string): LegacyIndex {
  const shrunk = shrinkBlobs(source);
  const root = parseSource(shrunk.text);
  const index: LegacyIndex = {
    work: shrunk.text,
    expand: shrunk.expand,
    root,
    byId: new Map(),
    byEditAttr: new Map(),
    texts: new Map(),
    images: new Map(),
    head: null,
    body: null,
  };

  const visit = (node: AstNode, id: string, parentId: string | null, insideText: boolean): void => {
    const tag = node.tagName!.toLowerCase();
    index.byId.set(id, { id, node, tag, parentId });
    const editAttr = attrOf(node, 'data-deck-edit-id');
    if (editAttr && !index.byEditAttr.has(editAttr)) index.byEditAttr.set(editAttr, id);
    if (tag === 'head' && !index.head) index.head = node;
    if (tag === 'body' && !index.body) index.body = node;

    const located = !!node.sourceCodeLocation;
    let textHere = insideText;
    if (
      !insideText &&
      located &&
      !NEVER_EDIT.has(tag) &&
      tag !== 'html' &&
      tag !== 'body' &&
      hasOwnText(node) &&
      isInlineOnly(node) &&
      // SVG <text> needs an explicit end tag to be spliced reliably; everything else may be implied.
      node.sourceCodeLocation!.startTag !== undefined
    ) {
      index.texts.set(id, {
        id,
        text: collectText(node),
        hasInlineChildren: elementChildren(node).length > 0,
      });
      textHere = true;
    }

    if (located) {
      if (tag === 'img' && attrOf(node, 'src') !== undefined) {
        index.images.set(id, { id, kind: 'img', src: attrOf(node, 'src')! });
      } else if (tag === 'image') {
        const href = attrOf(node, 'href') ?? attrOf(node, 'xlink:href');
        if (href) index.images.set(id, { id, kind: 'svg-image', src: href });
      } else if (INLINE_BG.test(attrOf(node, 'style') ?? '')) {
        const m = /url\(\s*["']?([^"')]*)["']?\s*\)/i.exec(attrOf(node, 'style')!);
        index.images.set(id, { id, kind: 'inline-bg', src: m?.[1] ?? '' });
      }
    }

    if (NEVER_EDIT.has(tag) && tag !== 'head') return;
    elementChildren(node).forEach((child, i) => visit(child, `${id}/${i}`, id, textHere));
  };

  elementChildren(root).forEach((child, i) => visit(child, String(i), null, false));
  return index;
}
