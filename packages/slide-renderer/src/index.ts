import type {
  ChartElement,
  CodeElement,
  DeckDocument,
  Fill,
  ImageElement,
  LineElement,
  RichDoc,
  RichNode,
  ShapeElement,
  Slide,
  SlideBackground,
  SlideElement,
  Stroke,
  TableElement,
  TextElement,
  TextMark,
  Theme,
} from '@hps/document-core';
import { LIST_INDENT_EM } from '@hps/document-core';

/**
 * Pure string renderer: editor canvas, thumbnails, presentation, print and exported files all use
 * this output (plan §6). No React, no DOM, so it runs in Node tests and workers alike.
 *
 * Trust boundary: every value is schema-validated or escaped here, and the output never contains
 * script or event handlers. The document schema has no raw-HTML field.
 */
export const RENDERER_VERSION = '1';

export interface RenderContext {
  page: { width: number; height: number };
  theme: Theme;
  /**
   * How to reference an asset. `src` inlines a URL; `hydrate` emits data-hps-asset so a single
   * stored copy serves every use (no duplicated base64).
   */
  assets: { mode: 'src'; url: (id: string) => string | undefined } | { mode: 'hydrate' };
}

export const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const n = (v: number): string => String(Math.round(v * 1000) / 1000);

export const fontStack = (primary: string | undefined, theme: Theme): string =>
  [primary ?? theme.fontFamily, ...theme.fontFallback]
    .filter((f, i, all) => f && all.indexOf(f) === i)
    .map((f) => (/^(?:sans-serif|serif|monospace|system-ui)$/.test(f!) ? f : `'${f}'`))
    .join(', ');

const SAFE_LINK = /^(?:https?:|mailto:|tel:)/i;

function imgTag(ctx: RenderContext, assetId: string, attrs: string): string {
  if (ctx.assets.mode === 'hydrate') {
    return `<img data-hps-asset="${esc(assetId)}" ${attrs}>`;
  }
  const url = ctx.assets.url(assetId);
  return url
    ? `<img src="${esc(url)}" ${attrs}>`
    : `<div class="hps-missing" ${attrs}>이미지 없음</div>`;
}

export function fillCss(fill: Fill | undefined): string {
  if (!fill) return '';
  switch (fill.type) {
    case 'none':
      return 'background:transparent;';
    case 'solid':
      return `background:${fill.color};`;
    case 'linear':
      return `background:linear-gradient(${n(fill.angle)}deg,${fill.stops.map((s) => `${s.color} ${n(s.offset * 100)}%`).join(',')});`;
    case 'radial':
      return `background:radial-gradient(circle,${fill.stops.map((s) => `${s.color} ${n(s.offset * 100)}%`).join(',')});`;
  }
}

const strokeCss = (s: Stroke | undefined): string =>
  s && s.width > 0 ? `border:${n(s.width)}px ${s.dash} ${s.color};` : '';

const dashArray = (s: Stroke): string =>
  s.dash === 'dashed'
    ? `stroke-dasharray="${n(s.width * 4)} ${n(s.width * 3)}"`
    : s.dash === 'dotted'
      ? `stroke-dasharray="${n(s.width)} ${n(s.width * 2)}" stroke-linecap="round"`
      : '';

/* ---- Text ---- */

function markWrap(text: string, marks: TextMark[] | undefined): string {
  let out = esc(text);
  const styles: string[] = [];
  let href: string | null = null;
  for (const m of marks ?? []) {
    switch (m.type) {
      case 'bold':
        out = `<strong>${out}</strong>`;
        break;
      case 'italic':
        out = `<em>${out}</em>`;
        break;
      case 'underline':
        out = `<u>${out}</u>`;
        break;
      case 'strike':
        out = `<s>${out}</s>`;
        break;
      case 'code':
        out = `<code>${out}</code>`;
        break;
      case 'link':
        if (SAFE_LINK.test(m.attrs.href)) href = m.attrs.href;
        break;
      case 'textStyle': {
        const a = m.attrs;
        if (a.color) styles.push(`color:${a.color}`);
        if (a.fontSizePx) styles.push(`font-size:${n(a.fontSizePx)}px`);
        if (a.fontFamily) styles.push(`font-family:'${a.fontFamily}'`);
        break;
      }
    }
  }
  if (styles.length) out = `<span style="${esc(styles.join(';'))}">${out}</span>`;
  if (href) out = `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${out}</a>`;
  return out;
}

const inline = (nodes: RichNode[] | undefined): string =>
  (nodes ?? [])
    .map((node) =>
      node.type === 'text'
        ? markWrap(node.text, node.marks)
        : node.type === 'hardBreak'
          ? '<br>'
          : '',
    )
    .join('');

const SAFE_ALIGN = /^(?:left|center|right|justify)$/;
const alignAttr = (a: string | null | undefined): string =>
  a && SAFE_ALIGN.test(a) ? ` style="text-align:${a}"` : '';

function block(node: RichNode): string {
  switch (node.type) {
    case 'paragraph':
      return `<p${alignAttr(node.attrs?.textAlign)}>${inline(node.content) || '<br>'}</p>`;
    case 'heading': {
      const level = Math.min(6, Math.max(1, node.attrs?.level ?? 1));
      return `<h${level}${alignAttr(node.attrs?.textAlign)}>${inline(node.content) || '<br>'}</h${level}>`;
    }
    case 'bulletList':
      return `<ul>${(node.content ?? []).map(block).join('')}</ul>`;
    case 'orderedList':
      return `<ol>${(node.content ?? []).map(block).join('')}</ol>`;
    case 'listItem':
      return `<li>${(node.content ?? []).map(block).join('')}</li>`;
    default:
      return '';
  }
}

export const renderRichDoc = (doc: RichDoc): string => doc.content.map(block).join('');

function renderText(el: TextElement, ctx: RenderContext): string {
  const s = el.style;
  const justify =
    s.valign === 'middle' ? 'center' : s.valign === 'bottom' ? 'flex-end' : 'flex-start';
  const style = [
    `display:flex;flex-direction:column;justify-content:${justify}`,
    `font-family:${fontStack(s.fontFamily, ctx.theme)}`,
    `font-size:${n(s.fontSizePx)}px`,
    `line-height:${n(s.lineHeight)}`,
    `font-weight:${s.fontWeight}`,
    s.italic ? 'font-style:italic' : '',
    `color:${s.color ?? ctx.theme.tokens.foreground}`,
    `text-align:${s.align}`,
    s.letterSpacingPx ? `letter-spacing:${n(s.letterSpacingPx)}px` : '',
    `padding:${n(s.padding)}px`,
    `--hps-para:${n(s.paragraphSpacingPx)}px`,
  ]
    .filter(Boolean)
    .join(';');
  return `<div class="hps-text" style="${esc(style + ';' + fillCss(el.fill))}"><div class="hps-text-body" data-hps-text>${renderRichDoc(el.content)}</div></div>`;
}

/* ---- Pictures ---- */

function renderImage(el: ImageElement, ctx: RenderContext): string {
  const radius = el.radius ? `border-radius:${n(el.radius)}px;` : '';
  const outer = `${radius}${strokeCss(el.stroke)}`;
  const alt = `alt="${esc(el.alt)}"`;
  if (el.crop && el.crop.w > 0 && el.crop.h > 0) {
    const { x, y, w, h } = el.crop;
    const style = `position:absolute;left:${n((-x / w) * 100)}%;top:${n((-y / h) * 100)}%;width:${n(100 / w)}%;height:${n(100 / h)}%;object-fit:fill;max-width:none`;
    return `<div class="hps-clip" style="${esc(outer)}">${imgTag(ctx, el.assetId, `${alt} style="${style}"`)}</div>`;
  }
  const pos = `${n(el.focal.x * 100)}% ${n(el.focal.y * 100)}%`;
  return `<div class="hps-clip" style="${esc(outer)}">${imgTag(ctx, el.assetId, `${alt} style="width:100%;height:100%;object-fit:${el.fit};object-position:${pos}"`)}</div>`;
}

/* ---- Shapes ---- */

const POLYGONS: Partial<Record<ShapeElement['shape'], (w: number, h: number) => string>> = {
  triangle: (w, h) => `${w / 2},0 ${w},${h} 0,${h}`,
  diamond: (w, h) => `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`,
  chevron: (w, h) => `0,0 ${w * 0.75},0 ${w},${h / 2} ${w * 0.75},${h} 0,${h} ${w * 0.25},${h / 2}`,
  arrowRight: (w, h) =>
    `0,${h * 0.25} ${w * 0.6},${h * 0.25} ${w * 0.6},0 ${w},${h / 2} ${w * 0.6},${h} ${w * 0.6},${h * 0.75} 0,${h * 0.75}`,
};

function svgGradient(fill: Fill, id: string): { defs: string; paint: string } {
  if (fill.type === 'none') return { defs: '', paint: 'none' };
  if (fill.type === 'solid') return { defs: '', paint: fill.color };
  const stops = fill.stops
    .map((s) => `<stop offset="${n(s.offset)}" stop-color="${s.color}"/>`)
    .join('');
  if (fill.type === 'radial') {
    return {
      defs: `<defs><radialGradient id="${id}">${stops}</radialGradient></defs>`,
      paint: `url(#${id})`,
    };
  }
  // CSS angle: 0deg points up, clockwise. Convert to a unit vector across the bounding box.
  const rad = ((fill.angle - 90) * Math.PI) / 180;
  const dx = Math.cos(rad) / 2;
  const dy = Math.sin(rad) / 2;
  return {
    defs: `<defs><linearGradient id="${id}" x1="${n(0.5 - dx)}" y1="${n(0.5 - dy)}" x2="${n(0.5 + dx)}" y2="${n(0.5 + dy)}">${stops}</linearGradient></defs>`,
    paint: `url(#${id})`,
  };
}

function renderShape(el: ShapeElement): string {
  const { w, h } = el.frame;
  if (el.shape === 'rect' || el.shape === 'roundRect' || el.shape === 'ellipse') {
    const radius =
      el.shape === 'ellipse'
        ? '50%'
        : `${n(el.shape === 'roundRect' ? el.radius || 32 : el.radius)}px`;
    return `<div class="hps-fill" style="${esc(`${fillCss(el.fill)}${strokeCss(el.stroke)}border-radius:${radius}`)}"></div>`;
  }
  const { defs, paint } = svgGradient(el.fill, `g-${el.id.replace(/[^\w-]/g, '')}`);
  const stroke =
    el.stroke && el.stroke.width > 0
      ? `stroke="${el.stroke.color}" stroke-width="${n(el.stroke.width)}" ${dashArray(el.stroke)}`
      : '';
  const points = POLYGONS[el.shape]!(w, h);
  return `<svg class="hps-fill" viewBox="0 0 ${n(w)} ${n(h)}" preserveAspectRatio="none" overflow="visible">${defs}<polygon points="${points}" fill="${paint}" ${stroke}/></svg>`;
}

function renderLine(el: LineElement): string {
  const { x1, y1, x2, y2 } = el.points;
  const sw = el.stroke.width;
  const markerId = el.id.replace(/[^\w-]/g, '');
  const marker = (id: string, reverse: boolean): string =>
    `<marker id="${id}" viewBox="0 0 10 10" refX="${reverse ? 1 : 9}" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="${reverse ? 'M10,0 L0,5 L10,10 z' : 'M0,0 L10,5 L0,10 z'}" fill="${el.stroke.color}"/></marker>`;
  const defs =
    el.startArrow || el.endArrow
      ? `<defs>${el.startArrow ? marker(`s-${markerId}`, true) : ''}${el.endArrow ? marker(`e-${markerId}`, false) : ''}</defs>`
      : '';
  const mx = (x1 + x2) / 2;
  const d =
    el.kind === 'curve'
      ? `M${n(x1)},${n(y1)} C${n(mx)},${n(y1)} ${n(mx)},${n(y2)} ${n(x2)},${n(y2)}`
      : `M${n(x1)},${n(y1)} L${n(x2)},${n(y2)}`;
  return `<svg class="hps-fill" viewBox="0 0 ${n(Math.max(el.frame.w, 1))} ${n(Math.max(el.frame.h, 1))}" overflow="visible">${defs}<path d="${d}" fill="none" stroke="${el.stroke.color}" stroke-width="${n(sw)}" ${dashArray(el.stroke)} ${el.startArrow ? `marker-start="url(#s-${markerId})"` : ''} ${el.endArrow ? `marker-end="url(#e-${markerId})"` : ''}/></svg>`;
}

/* ---- Data ---- */

function renderTable(el: TableElement, ctx: RenderContext): string {
  const total = el.columns.reduce((a, b) => a + b, 0);
  const cols = el.columns.map((c) => `<col style="width:${n((c / total) * 100)}%">`).join('');
  const border =
    el.border && el.border.width > 0
      ? `border:${n(el.border.width)}px ${el.border.dash} ${el.border.color};`
      : '';
  const rows = el.rows
    .map(
      (row) =>
        `<tr>${row
          .map((c) => {
            const style = `${border}text-align:${c.align};${c.bold ? 'font-weight:700;' : ''}${c.color ? `color:${c.color};` : ''}${c.fill ? `background:${c.fill};` : ''}`;
            return `<td style="${esc(style)}">${esc(c.text).replace(/\n/g, '<br>')}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('');
  const style = `font-size:${n(el.fontSizePx)}px;font-family:${fontStack(undefined, ctx.theme)};color:${ctx.theme.tokens.foreground}`;
  return `<table class="hps-table" style="${esc(style)}"><colgroup>${cols}</colgroup><tbody>${rows}</tbody></table>`;
}

function renderChart(el: ChartElement, ctx: RenderContext): string {
  if (el.renderedAssetId) {
    return imgTag(
      ctx,
      el.renderedAssetId,
      `alt="${esc(el.title ?? '차트')}" style="width:100%;height:100%;object-fit:fill"`,
    );
  }
  return `<div class="hps-missing">차트 ${esc(el.title ?? '')}</div>`;
}

function renderCode(el: CodeElement): string {
  const lines: { text: string; color?: string | undefined }[][] =
    el.tokens ?? el.code.split('\n').map((text) => [{ text }]);
  const body = lines
    .map((line) =>
      line
        .map((t) =>
          t.color ? `<span style="color:${esc(t.color)}">${esc(t.text)}</span>` : esc(t.text),
        )
        .join(''),
    )
    .join('\n');
  const style = `background:${el.background};color:${el.color};font-size:${n(el.fontSizePx)}px`;
  return `<pre class="hps-code" style="${esc(style)}"><code>${body}</code></pre>`;
}

export function renderElementInner(el: SlideElement, ctx: RenderContext): string {
  switch (el.type) {
    case 'text':
      return renderText(el, ctx);
    case 'image':
      return renderImage(el, ctx);
    case 'svg':
      return imgTag(ctx, el.assetId, `alt="${esc(el.alt)}" style="width:100%;height:100%"`);
    case 'shape':
      return renderShape(el);
    case 'line':
      return renderLine(el);
    case 'table':
      return renderTable(el, ctx);
    case 'chart':
      return renderChart(el, ctx);
    case 'code':
      return renderCode(el);
  }
}

export function renderElement(el: SlideElement, ctx: RenderContext): string {
  if (el.hidden) return '';
  const f = el.frame;
  const style = [
    `left:${n(f.x)}px;top:${n(f.y)}px;width:${n(f.w)}px;height:${n(f.h)}px`,
    f.rotate ? `transform:rotate(${n(f.rotate)}deg)` : '',
    el.opacity !== 1 ? `opacity:${n(el.opacity)}` : '',
    `z-index:${el.zIndex}`,
    el.shadow
      ? `filter:drop-shadow(${n(el.shadow.x)}px ${n(el.shadow.y)}px ${n(el.shadow.blur)}px ${el.shadow.color})`
      : '',
  ]
    .filter(Boolean)
    .join(';');
  return `<div class="hps-el hps-el-${el.type}" data-el-id="${esc(el.id)}" style="${esc(style)}">${renderElementInner(el, ctx)}</div>`;
}

export function renderBackground(bg: SlideBackground, ctx: RenderContext): string {
  switch (bg.type) {
    case 'solid':
      return `<div class="hps-bg" style="background:${bg.color}"></div>`;
    case 'linear':
    case 'radial':
      return `<div class="hps-bg" style="${esc(fillCss(bg))}"></div>`;
    case 'image': {
      const img = imgTag(ctx, bg.assetId, `alt="" class="hps-bg" style="object-fit:${bg.fit}"`);
      const overlay = bg.overlay
        ? `<div class="hps-bg" style="background:${bg.overlay}"></div>`
        : '';
      return img + overlay;
    }
  }
}

/** One slide, at model size. Scale it with `transform` on an outer element; coordinates never change with zoom. */
export function renderSlide(slide: Slide, ctx: RenderContext): string {
  const body = [...slide.elements]
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((el) => renderElement(el, ctx))
    .join('');
  return `<section class="hps-slide" data-slide-id="${esc(slide.id)}" style="width:${n(ctx.page.width)}px;height:${n(ctx.page.height)}px">${renderBackground(slide.background, ctx)}${body}</section>`;
}

export const contextFor = (doc: DeckDocument, assets: RenderContext['assets']): RenderContext => ({
  page: doc.page,
  theme: doc.theme,
  assets,
});

/** Shared stylesheet. Scoped by class so it can live in the editor page without leaking. */
export function deckCss(page: { width: number; height: number }): string {
  return `
.hps-slide{position:relative;overflow:hidden;display:block;box-sizing:border-box;margin:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.hps-slide *{box-sizing:border-box}
.hps-bg{position:absolute;inset:0;width:100%;height:100%;display:block}
.hps-el{position:absolute;transform-origin:center center}
.hps-text{width:100%;height:100%;overflow:visible;white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere}
.hps-text p,.hps-text h1,.hps-text h2,.hps-text h3,.hps-text h4,.hps-text h5,.hps-text h6{margin:0 0 var(--hps-para,0);font:inherit;min-height:1em}
.hps-text ul,.hps-text ol{margin:0;padding-left:${LIST_INDENT_EM}em}
.hps-text li>p{margin:0}
.hps-text a{color:inherit}
.hps-clip{position:relative;width:100%;height:100%;overflow:hidden}
.hps-clip img{display:block}
.hps-fill{display:block;width:100%;height:100%}
.hps-missing{display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:#e2e8f0;color:#475569;font-size:28px}
.hps-table{width:100%;height:100%;border-collapse:collapse;table-layout:fixed}
.hps-table td{padding:.35em .6em;vertical-align:middle;overflow-wrap:anywhere;word-break:keep-all}
.hps-code{margin:0;width:100%;height:100%;padding:32px;overflow:hidden;white-space:pre;line-height:1.5;font-family:Consolas,'D2Coding','Courier New',monospace;border-radius:12px;tab-size:2}
.hps-code code{font:inherit}
@page{size:${n(page.width)}px ${n(page.height)}px;margin:0}
`;
}
