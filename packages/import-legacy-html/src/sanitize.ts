import { parse, serialize } from 'parse5';
import { shrinkBlobs } from '@hps/security-scan';
import { elementChildren, type AstNode } from './ast.js';

/**
 * Builds the isolated preview document. Three independent layers guard the editor (ADR-008):
 *  1. this AST pass removes active content from a *preview copy* (the original is never altered);
 *  2. DOMPurify re-checks in the browser (see purify.ts);
 *  3. the host iframe is sandboxed without allow-scripts, and a CSP blocks all network access.
 */
export interface PreviewOptions {
  /** Explicit user opt-in: load external images, CSS and fonts over https. Scripts stay blocked. */
  allowExternal?: boolean;
  /** Filename -> data/blob URL, for assets the user supplied next to the HTML file. */
  localAssets?: Map<string, string>;
}

export interface PreviewResult {
  html: string;
  removed: { scripts: number; handlers: number; frames: number; plugins: number; other: number };
  externalResources: string[];
  missingLocalAssets: string[];
}

const DROP_TAGS = new Set([
  'script',
  'noscript',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'base',
  'portal',
  'audio',
  'video',
  'source',
  'track',
]);
const URL_ATTRS = new Set([
  'src',
  'href',
  'xlink:href',
  'data',
  'poster',
  'background',
  'action',
  'formaction',
  'cite',
  'longdesc',
  'usemap',
  'manifest',
  'ping',
  'srcset',
]);

const CSP_STRICT =
  "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'";
const CSP_EXTERNAL =
  "default-src 'none'; img-src data: blob: https:; media-src data: blob:; style-src 'unsafe-inline' https:; font-src data: https:; form-action 'none'; base-uri 'none'";

export const cspFor = (allowExternal: boolean | undefined): string =>
  allowExternal ? CSP_EXTERNAL : CSP_STRICT;

/** CSS injected into the preview only. Animations jump to their end state so nothing stays invisible. */
export const PREVIEW_CSS = `
*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition:none!important;caret-color:auto}
html,body{scroll-behavior:auto!important}
[data-hps-hidden]{display:none!important}
[data-hps-current]{visibility:visible!important;opacity:1!important}
[data-hps-hover]{outline:2px dashed #2563eb!important;outline-offset:2px!important;cursor:pointer!important}
[data-hps-selected]{outline:3px solid #2563eb!important;outline-offset:2px!important}
[data-hps-changed]{box-shadow:inset 0 0 0 9999px rgba(250,204,21,.18)!important}
[data-hps-editing]{outline:3px solid #16a34a!important;outline-offset:2px!important;cursor:text!important;user-select:text!important}
@media print{[data-hps-hover],[data-hps-selected],[data-hps-editing]{outline:none!important}}
`;

const fileNameOf = (url: string): string =>
  decodeURIComponent(url.split(/[?#]/)[0]!.split(/[\\/]/).pop() ?? '');

function schemeOf(raw: string): string | null {
  // Browsers strip these before resolving a scheme, so "java\nscript:" is still javascript:.

  const compact = raw.replace(/[\u0000- \u007f-\u009f]+/g, '');
  return /^([a-z][a-z0-9+.-]*):/i.exec(compact)?.[1]?.toLowerCase() ?? null;
}

interface WalkState extends PreviewResult {
  opts: PreviewOptions;
  externals: Set<string>;
  missing: Set<string>;
}

/** Rewrites one URL for the preview; returns null when the attribute must go. */
function rewriteUrl(state: WalkState, raw: string, tag: string, name: string): string | null {
  const value = raw.trim();
  if (!value) return raw;
  const scheme = schemeOf(value);
  if (name === 'href' && tag === 'a') {
    // Links stay visible, but a preview never navigates.
    return scheme === null || scheme === 'http' || scheme === 'https' || scheme === 'mailto'
      ? value
      : null;
  }
  if (scheme === 'data') {
    return /^data:image\/(?!svg)|^data:font\/|^data:application\/font|^data:application\/x-font|^data:text\/css/i.test(
      value,
    )
      ? value
      : /^data:image\/svg\+xml/i.test(value) && tag === 'img'
        ? value
        : null;
  }
  if (scheme === 'blob') return value;
  if (scheme === 'http' || scheme === 'https' || value.startsWith('//')) {
    state.externals.add(value);
    return state.opts.allowExternal && !/^http:/i.test(value) ? value : null;
  }
  if (scheme !== null) return null;
  if (value.startsWith('#')) return value;
  const local = state.opts.localAssets?.get(fileNameOf(value));
  if (local) return local;
  if (tag === 'img' || tag === 'image' || tag === 'link') state.missing.add(value);
  return value;
}

function cleanCss(state: WalkState, css: string): string {
  // @import "x" has no url(), so it needs its own pass.
  const noImports = state.opts.allowExternal
    ? css
    : css.replace(
        /@import\s+(?:url\(\s*)?["']?\s*((?:https?:)?\/\/[^"')\s;]{1,4096})["']?\s*\)?[^;]*;?/gi,
        (_m, url: string) => {
          state.externals.add(url);
          return '';
        },
      );
  return noImports.replace(
    /url\(\s*(["']?)([^"')]{0,4096})\1\s*\)/gi,
    (whole, _q: string, url: string) => {
      const u = url.trim();
      if (/^(?:https?:)?\/\//i.test(u)) {
        state.externals.add(u);
        // Removed here as well as blocked by CSP: a beacon should not depend on one layer.
        if (!state.opts.allowExternal) return 'url("")';
      } else if (!/^(?:data:|#|blob:)/i.test(u) && u) {
        const local = state.opts.localAssets?.get(fileNameOf(u));
        if (local) return `url("${local}")`;
        state.missing.add(u);
      } else if (/^data:(?:text\/html|application\/(?!font|x-font)|image\/svg)/i.test(u))
        return 'url("")';
      return whole;
    },
  );
}

function sanitizeNode(state: WalkState, node: AstNode, path: string): void {
  const kids = node.childNodes ?? [];
  const kept: AstNode[] = [];
  let elementIndex = 0;
  for (const child of kids) {
    if (child.nodeName === '#comment') continue;
    if (!child.tagName) {
      kept.push(child);
      continue;
    }
    // The id counts *original* element children so ids match the index.
    const childPath = path ? `${path}/${elementIndex}` : String(elementIndex);
    elementIndex++;
    const tag = child.tagName.toLowerCase();
    const r = state.removed;
    if (DROP_TAGS.has(tag)) {
      if (tag === 'script') r.scripts++;
      else if (tag === 'iframe' || tag === 'frame' || tag === 'frameset') r.frames++;
      else if (tag === 'object' || tag === 'embed' || tag === 'applet') r.plugins++;
      else r.other++;
      continue;
    }
    if (tag === 'meta') {
      const eq = child.attrs?.find((a) => a.name === 'http-equiv')?.value.toLowerCase();
      if (
        eq === 'refresh' ||
        eq === 'set-cookie' ||
        eq === 'content-security-policy' ||
        eq === 'content-type'
      ) {
        r.other++;
        continue;
      }
      if (child.attrs?.some((a) => a.name === 'charset')) continue;
    }
    if (tag === 'link') {
      const rel = child.attrs?.find((a) => a.name === 'rel')?.value.toLowerCase() ?? '';
      const href = child.attrs?.find((a) => a.name === 'href')?.value ?? '';
      if (!rel.split(/\s+/).includes('stylesheet')) {
        r.other++;
        continue;
      }
      const rewritten = rewriteUrl(state, href, 'link', 'href');
      if (
        rewritten === null ||
        !(/^https:/i.test(rewritten) || /^data:text\/css/i.test(rewritten))
      ) {
        if (rewritten !== null) state.missing.add(href);
        r.other++;
        continue;
      }
    }
    // parse5 restores SVG's camelCase (attributeName), so compare case-insensitively.
    if (
      (tag === 'animate' ||
        tag === 'set' ||
        tag === 'animatetransform' ||
        tag === 'animatemotion') &&
      child.attrs?.some(
        (a) => a.name.toLowerCase() === 'attributename' && /href|src/i.test(a.value),
      )
    ) {
      r.other++;
      continue;
    }
    if (tag === 'style') {
      for (const t of child.childNodes ?? []) {
        if (t.value) t.value = cleanCss(state, t.value);
      }
    }
    sanitizeAttrs(state, child, tag, childPath);
    if (child.content) sanitizeNode(state, child.content, childPath);
    if (tag !== 'style') sanitizeNode(state, child, childPath);
    kept.push(child);
  }
  node.childNodes = kept;
}

function sanitizeAttrs(state: WalkState, node: AstNode, tag: string, path: string): void {
  const attrs: NonNullable<AstNode['attrs']> = [];
  for (const a of node.attrs ?? []) {
    const name = (a.prefix ? `${a.prefix}:${a.name}` : a.name).toLowerCase();
    if (name.startsWith('on')) {
      state.removed.handlers++;
      continue;
    }
    if (name === 'srcdoc' || name === 'is' || name === 'integrity' || name === 'crossorigin')
      continue;
    if (name.startsWith('data-hps-')) continue; // A hostile file must not spoof editor state.
    if (name === 'srcset') {
      state.externals.add(a.value);
      continue;
    }
    if (name === 'style') {
      attrs.push({ ...a, value: cleanCss(state, a.value) });
      continue;
    }
    if (URL_ATTRS.has(name)) {
      const v = rewriteUrl(state, a.value, tag, name);
      if (v !== null) attrs.push({ ...a, value: v });
      else if (name === 'src' || name === 'xlink:href' || name === 'href') {
        if (tag === 'img' || tag === 'image')
          attrs.push({ name: 'data-hps-blocked-src', value: a.value });
      }
      continue;
    }
    attrs.push(a);
  }
  attrs.push({ name: 'data-hps-id', value: path });
  node.attrs = attrs;
}

/** Makes a sanitised copy of a source. Never touches the original text. */
export function buildPreview(source: string, opts: PreviewOptions = {}): PreviewResult {
  const shrunk = shrinkBlobs(source);
  const doc = parse(shrunk.text) as unknown as AstNode;
  const state: WalkState = {
    html: '',
    opts,
    removed: { scripts: 0, handlers: 0, frames: 0, plugins: 0, other: 0 },
    externalResources: [],
    missingLocalAssets: [],
    externals: new Set(),
    missing: new Set(),
  };
  sanitizeNode(state, doc, '');

  const html = elementChildren(doc).find((n) => n.tagName === 'html');
  const head = html && elementChildren(html).find((n) => n.tagName === 'head');
  if (head) {
    const inject = parse(
      `<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${cspFor(opts.allowExternal)}"><style data-hps-preview>${PREVIEW_CSS}</style></head>`,
    ) as unknown as AstNode;
    const injectedHead = elementChildren(elementChildren(inject)[0]!)[0]!;
    // The policy must precede every author node to apply to them.
    head.childNodes = [...(injectedHead.childNodes ?? []), ...(head.childNodes ?? [])];
  }
  return {
    // The serialiser keeps the file's own doctype. Adding one would change how doctype-less files render.
    html: shrunk.expand(serialize(doc as never)),
    removed: state.removed,
    externalResources: [...state.externals],
    missingLocalAssets: [...state.missing],
  };
}

/** Sandbox flags for preview frames. allow-scripts is forbidden here (plan §9). */
export const PREVIEW_SANDBOX = 'allow-same-origin';
