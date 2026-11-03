import { LIST_INDENT_EM, newId, SlideElement } from '@hps/document-core';
import type {
  AssetMeta,
  Fill,
  RichDoc,
  RichNode,
  Slide,
  SlideBackground,
  TextMark,
} from '@hps/document-core';
import { INLINE_TAGS } from './ast.js';

/**
 * L2/L3 conversion (plan §3): reads computed layout from the sanitised preview DOM and builds
 * native elements. Grid/flex layout is not reversed; it is flattened to measured positions.
 * Whatever cannot be mapped is captured as an image and listed in `losses`, never dropped silently.
 */
export interface ConvertAdapter {
  page: { width: number; height: number };
  /** Register bytes as an asset, returning its id. */
  addAsset(dataUrl: string, meta: Pick<AssetMeta, 'kind' | 'name'>): Promise<string>;
  /** Rasterise an element to a PNG data URL, or null if that fails. */
  capture(el: HTMLElement): Promise<string | null>;
}

export interface ConvertLoss {
  slide: number;
  elementId?: string;
  kind: 'frozen' | 'dropped' | 'approximated';
  reason: string;
}

export interface ConvertResult {
  slide: Slide;
  losses: ConvertLoss[];
  stats: { text: number; image: number; shape: number; table: number; svg: number; frozen: number };
}

const HEX = (n: number): string => Math.round(n).toString(16).padStart(2, '0');

export function cssColorToHex(css: string | null | undefined): string | null {
  if (!css) return null;
  if (css === 'transparent') return 'transparent';
  if (/^#[0-9a-f]{3,8}$/i.test(css)) return css;
  const m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+)(%?))?\s*\)$/.exec(css);
  if (!m) return null;
  const alpha = m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1);
  if (alpha === 0) return 'transparent';
  const rgb = `#${HEX(+m[1]!)}${HEX(+m[2]!)}${HEX(+m[3]!)}`;
  return alpha >= 1 ? rgb : `${rgb}${HEX(alpha * 255)}`;
}

/** Split on top-level commas (colours contain commas too). */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Parse computed `linear-gradient`/`radial-gradient`. Anything fancier returns null. */
export function parseGradient(css: string): Extract<Fill, { type: 'linear' | 'radial' }> | null {
  const m = /^(linear|radial)-gradient\((.*)\)$/.exec(css.trim());
  if (!m) return null;
  const args = splitArgs(m[2]!);
  let angle = 180;
  if (m[1] === 'linear' && args[0] && /deg$|^to /.test(args[0])) {
    const first = args.shift()!;
    const dirs: Record<string, number> = {
      'to top': 0,
      'to right': 90,
      'to bottom': 180,
      'to left': 270,
    };
    if (first in dirs) angle = dirs[first]!;
    else if (first.endsWith('deg')) angle = parseFloat(first);
    else return null;
  } else if (m[1] === 'radial' && args[0] && !/^(?:rgb|#|hsl)/.test(args[0])) {
    args.shift();
  }
  const stops: { offset: number; color: string }[] = [];
  args.forEach((arg, i) => {
    const sm = /^(rgba?\([^)]*\)|#[0-9a-f]+|transparent)(?:\s+([\d.]+)%)?$/i.exec(arg);
    const color = sm && cssColorToHex(sm[1]);
    if (!color) return;
    stops.push({
      offset: sm[2] !== undefined ? +sm[2] / 100 : i / Math.max(1, args.length - 1),
      color,
    });
  });
  if (stops.length < 2 || stops.length !== args.length) return null;
  return m[1] === 'linear' ? { type: 'linear', angle, stops } : { type: 'radial', stops };
}

interface Run {
  text: string;
  marks: TextMark[];
}

function marksFor(
  el: Element,
  cs: CSSStyleDeclaration,
  base: CSSStyleDeclaration,
  scale: number,
): TextMark[] {
  const marks: TextMark[] = [];
  if (parseInt(cs.fontWeight, 10) >= 600 && parseInt(base.fontWeight, 10) < 600)
    marks.push({ type: 'bold' });
  if (cs.fontStyle === 'italic' && base.fontStyle !== 'italic') marks.push({ type: 'italic' });
  if (cs.textDecorationLine.includes('underline')) marks.push({ type: 'underline' });
  if (cs.textDecorationLine.includes('line-through')) marks.push({ type: 'strike' });
  const href = el.closest('a')?.getAttribute('href');
  if (href && /^(?:https?:|mailto:)/i.test(href)) marks.push({ type: 'link', attrs: { href } });
  const attrs: Record<string, unknown> = {};
  if (cs.color !== base.color) attrs.color = cssColorToHex(cs.color);
  if (cs.fontSize !== base.fontSize) attrs.fontSizePx = parseFloat(cs.fontSize) * scale;
  if (Object.values(attrs).some((v) => v !== null))
    marks.push({ type: 'textStyle', attrs } as TextMark);
  return marks;
}

function richFromBlock(
  block: HTMLElement,
  base: CSSStyleDeclaration,
  scale: number,
  win: Window,
): RichDoc {
  const lines: Run[][] = [[]];
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      const text = (node.nodeValue ?? '').replace(/\s+/g, ' ');
      if (!text) return;
      const parent = node.parentElement!;
      lines[lines.length - 1]!.push({
        text,
        marks: marksFor(parent, win.getComputedStyle(parent), base, scale),
      });
    } else if (node.nodeType === 1) {
      if ((node as Element).tagName === 'BR') lines.push([]);
      else node.childNodes.forEach(walk);
    }
  };
  block.childNodes.forEach(walk);
  const content: RichNode[] = lines.map((runs, li) => {
    const trimmed = runs
      .map((r, i) => ({
        ...r,
        text:
          i === 0 && (li === 0 || runs.length)
            ? r.text.replace(/^\s+/, '')
            : i === runs.length - 1
              ? r.text.replace(/\s+$/, '')
              : r.text,
      }))
      .filter((r) => r.text);
    return {
      type: 'paragraph',
      ...(trimmed.length
        ? {
            content: trimmed.map((r) => ({
              type: 'text' as const,
              text: r.text,
              ...(r.marks.length ? { marks: r.marks } : {}),
            })),
          }
        : {}),
    };
  });
  return { type: 'doc', content };
}

const isVisible = (el: HTMLElement, cs: CSSStyleDeclaration): boolean => {
  if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0)
    return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

const isTextBlock = (el: HTMLElement): boolean => {
  if (!(el.textContent ?? '').trim()) return false;
  const check = (n: Element): boolean =>
    [...n.children].every((c) => INLINE_TAGS.has(c.tagName.toLowerCase()) && check(c));
  return check(el);
};

const hasDirectText = (el: Element): boolean =>
  [...el.childNodes].some((n) => n.nodeType === 3 && (n.nodeValue ?? '').trim());

const COMPLEX_STYLE = (cs: CSSStyleDeclaration): string | null => {
  if (cs.backdropFilter && cs.backdropFilter !== 'none') return 'backdrop-filter';
  if (cs.filter && cs.filter !== 'none') return 'filter';
  if (cs.clipPath && cs.clipPath !== 'none') return 'clip-path';
  if (cs.maskImage && cs.maskImage !== 'none') return 'mask';
  if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') return 'mix-blend-mode';
  return null;
};

function rotationOf(cs: CSSStyleDeclaration): number {
  const m = /^matrix\(([^)]+)\)$/.exec(cs.transform);
  if (!m) return 0;
  const [a, b] = m[1]!.split(',').map(Number);
  return Math.round((Math.atan2(b!, a!) * 180) / Math.PI);
}

/** Convert one rendered slide element. The slide must currently be displayed. */
export async function convertSlide(
  slideEl: HTMLElement,
  slideIndex: number,
  adapter: ConvertAdapter,
): Promise<ConvertResult> {
  const win = slideEl.ownerDocument.defaultView!;
  const box = slideEl.getBoundingClientRect();
  const scale = adapter.page.width / Math.max(1, box.width);
  const losses: ConvertLoss[] = [];
  const stats = { text: 0, image: 0, shape: 0, table: 0, svg: 0, frozen: 0 };
  const elements: SlideElement[] = [];

  const frameOf = (el: Element, cs: CSSStyleDeclaration) => {
    const rect = el.getBoundingClientRect();
    const rotate = rotationOf(cs);
    const w = rotate ? (el as HTMLElement).offsetWidth * 1 : rect.width;
    const h = rotate ? (el as HTMLElement).offsetHeight * 1 : rect.height;
    const cx = rect.left + rect.width / 2 - box.left;
    const cy = rect.top + rect.height / 2 - box.top;
    return {
      x: Math.round((cx - w / 2) * scale),
      y: Math.round((cy - h / 2) * scale),
      w: Math.round(w * scale),
      h: Math.round(h * scale),
      rotate,
    };
  };

  const push = (raw: Record<string, unknown>): void => {
    const parsed = SlideElement.safeParse({ id: newId('el'), zIndex: elements.length, ...raw });
    if (parsed.success) elements.push(parsed.data);
    else
      losses.push({
        slide: slideIndex,
        kind: 'dropped',
        reason: `변환 데이터 오류: ${parsed.error.issues[0]?.message ?? ''}`,
      });
  };

  const freeze = async (
    el: HTMLElement,
    cs: CSSStyleDeclaration,
    reason: string,
  ): Promise<void> => {
    const dataUrl = await adapter.capture(el).catch(() => null);
    const id = el.getAttribute('data-hps-id') ?? undefined;
    if (!dataUrl) {
      losses.push({
        slide: slideIndex,
        ...(id ? { elementId: id } : {}),
        kind: 'dropped',
        reason: `${reason} — 이미지 고정 실패`,
      });
      return;
    }
    const assetId = await adapter.addAsset(dataUrl, {
      kind: 'image',
      name: `slide${slideIndex + 1}-frozen.png`,
    });
    push({ type: 'image', assetId, frame: frameOf(el, cs), fit: 'fill', name: `고정: ${reason}` });
    stats.frozen++;
    losses.push({ slide: slideIndex, ...(id ? { elementId: id } : {}), kind: 'frozen', reason });
  };

  const paintBox = (el: HTMLElement, cs: CSSStyleDeclaration): boolean => {
    const bgColor = cssColorToHex(cs.backgroundColor);
    const hasBgColor = !!bgColor && bgColor !== 'transparent';
    const gradient = cs.backgroundImage !== 'none' ? parseGradient(cs.backgroundImage) : null;
    const borderW = parseFloat(cs.borderTopWidth) || 0;
    const borderColor =
      borderW > 0 && cs.borderTopStyle !== 'none' ? cssColorToHex(cs.borderTopColor) : null;
    const uniformBorder =
      cs.borderTopWidth === cs.borderRightWidth &&
      cs.borderTopWidth === cs.borderBottomWidth &&
      cs.borderTopWidth === cs.borderLeftWidth;
    if (!hasBgColor && !gradient && !borderColor) return false;
    const radius = parseFloat(cs.borderTopLeftRadius) || 0;
    const isCircle = cs.borderTopLeftRadius === '50%';
    const frame = frameOf(el, cs);
    const shadow = /^(rgba?\([^)]*\)|#\w+)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/.exec(
      cs.boxShadow,
    );
    const fill = gradient ?? (hasBgColor ? { type: 'solid', color: bgColor } : { type: 'none' });
    push({
      type: 'shape',
      shape: isCircle ? 'ellipse' : radius > 0 ? 'roundRect' : 'rect',
      radius: radius * scale,
      frame,
      fill,
      opacity: parseFloat(cs.opacity),
      ...(borderColor ? { stroke: { color: borderColor, width: borderW * scale } } : {}),
      ...(shadow && cssColorToHex(shadow[1])
        ? {
            shadow: {
              color: cssColorToHex(shadow[1]),
              x: +shadow[2]! * scale,
              y: +shadow[3]! * scale,
              blur: +shadow[4]! * scale,
            },
          }
        : {}),
    });
    stats.shape++;
    if (borderColor && !uniformBorder) {
      losses.push({
        slide: slideIndex,
        kind: 'approximated',
        reason: '방향별로 다른 테두리를 하나의 테두리로 변환',
      });
    }
    return true;
  };

  const emitText = (el: HTMLElement, cs: CSSStyleDeclaration): void => {
    const lineHeightPx = parseFloat(cs.lineHeight);
    const fontPx = parseFloat(cs.fontSize);
    const family = cs.fontFamily
      .split(',')[0]!
      .trim()
      .replace(/^["']|["']$/g, '');
    push({
      type: 'text',
      frame: frameOf(el, cs),
      opacity: parseFloat(cs.opacity),
      content: richFromBlock(el, cs, scale, win),
      style: {
        fontFamily: family || undefined,
        fontSizePx: fontPx * scale,
        fontWeight: Math.min(900, Math.max(100, parseInt(cs.fontWeight, 10) || 400)),
        italic: cs.fontStyle === 'italic',
        color: cssColorToHex(cs.color) ?? undefined,
        lineHeight: Number.isFinite(lineHeightPx) ? lineHeightPx / fontPx : 1.2,
        letterSpacingPx: (parseFloat(cs.letterSpacing) || 0) * scale,
        align: ['center', 'right', 'justify'].includes(cs.textAlign) ? cs.textAlign : 'left',
        valign: 'top',
        padding: (parseFloat(cs.paddingTop) || 0) * scale,
      },
    });
    stats.text++;
    if (
      cs.textShadow !== 'none' ||
      (cs.backgroundClip === 'text' && cs.backgroundImage !== 'none')
    ) {
      losses.push({
        slide: slideIndex,
        kind: 'approximated',
        reason: '글자 그림자 또는 그라데이션 글자는 단색으로 변환',
      });
    }
  };

  /** A plain list becomes one list element, so its markers and numbering stay real. */
  const emitList = (el: HTMLElement, cs: CSSStyleDeclaration): boolean => {
    const tag = el.tagName.toLowerCase();
    if (tag !== 'ul' && tag !== 'ol') return false;
    const items = [...el.children] as HTMLElement[];
    if (!items.length) return false;
    const plain = items.every((li) => {
      const lcs = win.getComputedStyle(li);
      return (
        li.tagName === 'LI' &&
        lcs.display === 'list-item' &&
        lcs.listStyleType !== 'none' &&
        lcs.backgroundColor === 'rgba(0, 0, 0, 0)' &&
        parseFloat(lcs.borderTopWidth) === 0 &&
        isVisible(li, lcs) &&
        isTextBlock(li)
      );
    });
    if (!plain) return false;
    const first = items[0]!;
    const fcs = win.getComputedStyle(first);
    const fontPx = parseFloat(fcs.fontSize);
    const lineHeightPx = parseFloat(fcs.lineHeight);
    const family = fcs.fontFamily
      .split(',')[0]!
      .trim()
      .replace(/^["']|["']$/g, '');
    // The renderer and the PPTX export both indent list text by LIST_INDENT_EM. Start the box that
    // far left of the item so the text stays where the original deck put it.
    const firstRect = first.getBoundingClientRect();
    const lastRect = items[items.length - 1]!.getBoundingClientRect();
    const left = firstRect.left - LIST_INDENT_EM * fontPx;
    push({
      type: 'text',
      frame: {
        x: Math.round((left - box.left) * scale),
        y: Math.round((firstRect.top - box.top) * scale),
        w: Math.round((firstRect.right - left) * scale),
        h: Math.round((lastRect.bottom - firstRect.top) * scale),
        rotate: rotationOf(cs),
      },
      opacity: parseFloat(cs.opacity),
      content: {
        type: 'doc',
        content: [
          {
            type: tag === 'ol' ? 'orderedList' : 'bulletList',
            content: items.map((li) => ({
              type: 'listItem',
              content: richFromBlock(li, win.getComputedStyle(li), scale, win).content,
            })),
          },
        ],
      },
      style: {
        fontFamily: family || undefined,
        fontSizePx: fontPx * scale,
        fontWeight: Math.min(900, Math.max(100, parseInt(fcs.fontWeight, 10) || 400)),
        italic: fcs.fontStyle === 'italic',
        color: cssColorToHex(fcs.color) ?? undefined,
        lineHeight: Number.isFinite(lineHeightPx) ? lineHeightPx / fontPx : 1.2,
        letterSpacingPx: (parseFloat(fcs.letterSpacing) || 0) * scale,
        align: ['center', 'right', 'justify'].includes(fcs.textAlign) ? fcs.textAlign : 'left',
        valign: 'top',
        padding: 0,
      },
    });
    stats.text++;
    if (!['disc', 'decimal'].includes(fcs.listStyleType) || el.hasAttribute('start')) {
      losses.push({
        slide: slideIndex,
        kind: 'approximated',
        reason: `목록 기호(${fcs.listStyleType})를 기본 글머리 기호나 1부터 시작하는 번호로 변환`,
      });
    }
    return true;
  };

  const walk = async (el: HTMLElement): Promise<void> => {
    const cs = win.getComputedStyle(el);
    if (!isVisible(el, cs)) return;
    const tag = el.tagName.toLowerCase();
    const complex = COMPLEX_STYLE(cs);
    if (complex || tag === 'canvas' || tag === 'video' || tag === 'math') {
      await freeze(el, cs, complex ?? `<${tag}> 요소`);
      return;
    }
    if (tag === 'img') {
      const src = el.getAttribute('src') ?? '';
      if (/^data:image\/|^blob:/.test(src)) {
        const assetId = await adapter.addAsset(src, {
          kind: 'image',
          name: el.getAttribute('alt') ?? 'image',
        });
        const fit =
          cs.objectFit === 'contain' ? 'contain' : cs.objectFit === 'cover' ? 'cover' : 'fill';
        push({
          type: 'image',
          assetId,
          frame: frameOf(el, cs),
          alt: el.getAttribute('alt') ?? '',
          fit,
          radius: (parseFloat(cs.borderTopLeftRadius) || 0) * scale,
          opacity: parseFloat(cs.opacity),
        });
        stats.image++;
      } else {
        await freeze(el, cs, '내장되지 않은 이미지');
      }
      return;
    }
    if (tag === 'svg') {
      const serialized = new XMLSerializer().serializeToString(el);
      const clean = serialized.replace(/\sdata-hps-[\w-]+="[^"]*"/g, '');
      const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(clean)))}`;
      const assetId = await adapter.addAsset(dataUrl, { kind: 'svg', name: 'vector.svg' });
      push({ type: 'svg', assetId, frame: frameOf(el, cs), opacity: parseFloat(cs.opacity) });
      stats.svg++;
      return;
    }
    if (tag === 'table') {
      const table = el as HTMLTableElement;
      const rows = [...table.rows].map((row) =>
        [...row.cells].map((cell) => {
          const ccs = win.getComputedStyle(cell);
          const fill = cssColorToHex(ccs.backgroundColor);
          return {
            text: (cell.textContent ?? '').trim(),
            bold: parseInt(ccs.fontWeight, 10) >= 600,
            align: ['center', 'right'].includes(ccs.textAlign) ? ccs.textAlign : 'left',
            color: cssColorToHex(ccs.color) ?? undefined,
            ...(fill && fill !== 'transparent' ? { fill } : {}),
          };
        }),
      );
      const widths = [...(table.rows[0]?.cells ?? [])].map((c) =>
        Math.max(1, c.getBoundingClientRect().width),
      );
      if (table.querySelector('[rowspan],[colspan]')) {
        await freeze(el, cs, '병합 셀이 있는 표');
        return;
      }
      if (rows.length && widths.length) {
        push({
          type: 'table',
          frame: frameOf(el, cs),
          columns: widths,
          rows,
          fontSizePx: parseFloat(cs.fontSize) * scale,
        });
        stats.table++;
        return;
      }
    }
    const bgImage = cs.backgroundImage;
    if (bgImage !== 'none' && !parseGradient(bgImage)) {
      await freeze(el, cs, '배경 이미지가 있는 요소');
      return;
    }
    paintBox(el, cs);
    if (emitList(el, cs)) return;
    if (isTextBlock(el)) {
      if (cs.display === 'list-item' && cs.listStyleType !== 'none') {
        // Reached only for lists emitList declined (nested or styled items).
        losses.push({
          slide: slideIndex,
          kind: 'approximated',
          reason: '복잡한 목록의 글머리 기호나 번호가 빠짐',
        });
      }
      emitText(el, cs);
      return;
    }
    if (hasDirectText(el)) {
      // Text mixed with block children has no single text box; keep its look instead of losing it.
      losses.push({
        slide: slideIndex,
        kind: 'approximated',
        reason: '블록과 섞인 글자는 줄 단위로 분리됨',
      });
      for (const node of [...el.childNodes]) {
        if (node.nodeType === 3 && (node.nodeValue ?? '').trim()) {
          const range = el.ownerDocument.createRange();
          range.selectNodeContents(node);
          const r = range.getBoundingClientRect();
          push({
            type: 'text',
            frame: {
              x: Math.round((r.left - box.left) * scale),
              y: Math.round((r.top - box.top) * scale),
              w: Math.round(r.width * scale) + 4,
              h: Math.round(r.height * scale),
              rotate: 0,
            },
            content: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: (node.nodeValue ?? '').trim() }],
                },
              ],
            },
            style: {
              fontSizePx: parseFloat(cs.fontSize) * scale,
              color: cssColorToHex(cs.color) ?? undefined,
              fontWeight: parseInt(cs.fontWeight, 10) || 400,
            },
          });
          stats.text++;
        }
      }
    }
    for (const child of el.children) await walk(child as HTMLElement);
  };

  const scs = win.getComputedStyle(slideEl);
  let background: SlideBackground = { type: 'solid', color: '#ffffff' };
  const bgHex = cssColorToHex(scs.backgroundColor);
  const grad = scs.backgroundImage !== 'none' ? parseGradient(scs.backgroundImage) : null;
  if (grad) background = grad;
  else if (scs.backgroundImage !== 'none') {
    losses.push({
      slide: slideIndex,
      kind: 'approximated',
      reason: '슬라이드 배경 이미지를 해석하지 못해 단색으로 대체',
    });
    if (bgHex && bgHex !== 'transparent') background = { type: 'solid', color: bgHex };
  } else if (bgHex && bgHex !== 'transparent') background = { type: 'solid', color: bgHex };
  else {
    const bodyHex = cssColorToHex(win.getComputedStyle(slideEl.ownerDocument.body).backgroundColor);
    if (bodyHex && bodyHex !== 'transparent') background = { type: 'solid', color: bodyHex };
  }

  for (const child of slideEl.children) await walk(child as HTMLElement);
  if (isTextBlock(slideEl) && !slideEl.children.length) emitText(slideEl, scs);

  return {
    slide: { id: newId('slide'), hidden: false, background, notes: '', elements },
    losses,
    stats,
  };
}

/** L3: the slide becomes one picture, with room for new elements on top. */
export async function freezeSlide(
  slideEl: HTMLElement,
  slideIndex: number,
  adapter: ConvertAdapter,
): Promise<ConvertResult> {
  const dataUrl = await adapter.capture(slideEl);
  const losses: ConvertLoss[] = [];
  let background: SlideBackground = { type: 'solid', color: '#ffffff' };
  if (dataUrl) {
    const assetId = await adapter.addAsset(dataUrl, {
      kind: 'image',
      name: `slide${slideIndex + 1}.png`,
    });
    background = { type: 'image', assetId, fit: 'cover' };
    losses.push({ slide: slideIndex, kind: 'frozen', reason: '슬라이드 전체를 이미지로 고정' });
  } else {
    losses.push({ slide: slideIndex, kind: 'dropped', reason: '슬라이드 캡처 실패' });
  }
  return {
    slide: { id: newId('slide'), hidden: false, background, notes: '', elements: [] },
    losses,
    stats: { text: 0, image: 0, shape: 0, table: 0, svg: 0, frozen: dataUrl ? 1 : 0 },
  };
}
