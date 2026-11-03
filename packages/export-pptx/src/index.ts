import PptxGenJS from 'pptxgenjs';
import { createUnitConverter, LIST_INDENT_EM, plainTextFromDoc } from '@hps/document-core';
import type {
  ChartElement,
  CodeElement,
  DeckDocument,
  Fill,
  ImageElement,
  LineElement,
  RichNode,
  ShapeElement,
  Slide,
  SlideElement,
  Stroke,
  TableElement,
  TextElement,
  TextMark,
} from '@hps/document-core';
import { emptyCounts, type ExportReport, type ReportItem } from '@hps/export-report';

export type PptxMode = 'editable' | 'fidelity';

/**
 * Browser services the mapper cannot do alone. Export logic stays free of app state and of DOM,
 * so everything except rasterising is testable in Node.
 */
export interface PptxAdapter {
  /** asset id -> data URL */
  assetUrl(id: string): string | undefined;
  /** Full slide as PNG data URL. Required for fidelity mode. */
  rasterizeSlide?(slide: Slide, index: number): Promise<string | null>;
  /** One element as PNG data URL, for effects PPTX cannot express. */
  rasterizeElement?(el: SlideElement, slide: Slide, index: number): Promise<string | null>;
  /** Re-encode a data URL as PNG (WebP/AVIF/SVG fallback). */
  toPng?(dataUrl: string): Promise<string | null>;
}

export interface PptxResult {
  bytes: Uint8Array;
  report: ExportReport;
}

const PPTX_SAFE_IMAGE = /^data:image\/(?:png|jpe?g|gif);base64,/i;

/** "#rrggbbaa" -> pptx colour and 0..100 transparency. */
export function pptxColor(
  color: string | undefined,
): { color: string; transparency: number } | null {
  if (!color || color === 'transparent') return null;
  let hex = color.replace('#', '');
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
  return { color: hex.slice(0, 6).toUpperCase(), transparency: Math.round((1 - alpha) * 100) };
}

const DASH: Record<Stroke['dash'], 'solid' | 'dash' | 'sysDot'> = {
  solid: 'solid',
  dashed: 'dash',
  dotted: 'sysDot',
};

const SHAPE: Record<ShapeElement['shape'], string> = {
  rect: 'rect',
  roundRect: 'roundRect',
  ellipse: 'ellipse',
  triangle: 'triangle',
  diamond: 'diamond',
  chevron: 'chevron',
  arrowRight: 'rightArrow',
};

interface Ctx {
  doc: DeckDocument;
  pptx: PptxGenJS;
  adapter: PptxAdapter;
  items: ReportItem[];
  counts: ReturnType<typeof emptyCounts>;
  fonts: Set<string>;
  u: ReturnType<typeof createUnitConverter>;
}

const note = (
  ctx: Ctx,
  slide: number,
  code: string,
  message: string,
  elementId?: string,
  severity: ReportItem['severity'] = 'warning',
): void => {
  ctx.items.push({
    slide: slide + 1,
    code,
    message,
    severity,
    ...(elementId ? { elementId } : {}),
  });
};

const box = (ctx: Ctx, el: SlideElement) => ({
  x: ctx.u.inches(el.frame.x),
  y: ctx.u.inches(el.frame.y),
  w: ctx.u.inches(el.frame.w),
  h: ctx.u.inches(el.frame.h),
  ...(el.frame.rotate ? { rotate: ((el.frame.rotate % 360) + 360) % 360 } : {}),
});

const opacityToTransparency = (o: number): number => Math.round((1 - o) * 100);

const stripData = (url: string): string => url.replace(/^data:/, '');

/** A picture PowerPoint can open: PNG/JPEG/GIF as is, others through the adapter. */
async function safeImage(ctx: Ctx, url: string): Promise<string | null> {
  if (PPTX_SAFE_IMAGE.test(url)) return url;
  return (await ctx.adapter.toPng?.(url)) ?? null;
}

async function fallbackImage(
  ctx: Ctx,
  el: SlideElement,
  slide: Slide,
  index: number,
  reason: string,
  target: PptxGenJS.Slide,
): Promise<boolean> {
  const dataUrl = await ctx.adapter.rasterizeElement?.(el, slide, index);
  if (dataUrl) {
    target.addImage({
      data: stripData(dataUrl),
      ...box(ctx, { ...el, frame: { ...el.frame, rotate: 0 } }),
    });
    ctx.counts.imageFallback++;
    note(ctx, index, 'image-fallback', `${reason} → 이미지로 변환`, el.id);
    return true;
  }
  return false;
}

function solidOf(fill: Fill | undefined): { color: string; transparency: number } | null {
  if (!fill) return null;
  if (fill.type === 'solid') return pptxColor(fill.color);
  if (fill.type === 'linear' || fill.type === 'radial') return pptxColor(fill.stops[0]?.color);
  return null;
}

/* ---- Text ---- */

interface Run {
  text: string;
  options: Record<string, unknown>;
}

function runOptions(
  ctx: Ctx,
  el: TextElement,
  marks: TextMark[] | undefined,
): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const m of marks ?? []) {
    switch (m.type) {
      case 'bold':
        o.bold = true;
        break;
      case 'italic':
        o.italic = true;
        break;
      case 'underline':
        o.underline = { style: 'sng' };
        break;
      case 'strike':
        o.strike = 'sngStrike';
        break;
      case 'code':
        o.fontFace = 'Consolas';
        break;
      case 'link':
        if (/^(?:https?:|mailto:)/i.test(m.attrs.href)) o.hyperlink = { url: m.attrs.href };
        break;
      case 'textStyle': {
        const c = pptxColor(m.attrs.color ?? undefined);
        if (c) o.color = c.color;
        if (m.attrs.fontSizePx) o.fontSize = ctx.u.points(m.attrs.fontSizePx);
        if (m.attrs.fontFamily) {
          o.fontFace = m.attrs.fontFamily;
          ctx.fonts.add(m.attrs.fontFamily);
        }
        break;
      }
    }
  }
  void el;
  return o;
}

function textRuns(ctx: Ctx, el: TextElement): Run[] {
  const runs: Run[] = [];
  const paragraph = (nodes: RichNode[] | undefined, paraOpts: Record<string, unknown>): void => {
    const start = runs.length;
    for (const node of nodes ?? []) {
      if (node.type === 'text')
        runs.push({
          text: node.text,
          options: { ...paraOpts, ...runOptions(ctx, el, node.marks) },
        });
      else if (node.type === 'hardBreak') {
        const last = runs[runs.length - 1];
        if (last) last.options.softBreakBefore = false;
        runs.push({ text: '', options: { ...paraOpts, softBreakBefore: true } });
      }
    }
    if (runs.length === start) runs.push({ text: '', options: { ...paraOpts } });
    runs[runs.length - 1]!.options.breakLine = true;
  };
  const walk = (node: RichNode, paraOpts: Record<string, unknown>, depth: number): void => {
    switch (node.type) {
      case 'paragraph':
      case 'heading': {
        const align = node.attrs?.textAlign;
        paragraph(node.content, {
          ...paraOpts,
          ...(align && /^(left|center|right|justify)$/.test(align) ? { align } : {}),
        });
        break;
      }
      case 'bulletList':
      case 'orderedList':
        for (const item of node.content ?? []) {
          walk(
            item,
            {
              ...paraOpts,
              bullet: {
                ...(node.type === 'orderedList' ? { type: 'number' } : {}),
                indent: ctx.u.points(el.style.fontSizePx * LIST_INDENT_EM),
              },
              indentLevel: depth,
            },
            depth + 1,
          );
        }
        break;
      case 'listItem':
        for (const child of node.content ?? []) walk(child, paraOpts, depth);
        break;
      default:
        break;
    }
  };
  el.content.content.forEach((n) => walk(n, {}, 0));
  const last = runs[runs.length - 1];
  if (last) delete last.options.breakLine;
  return runs;
}

/**
 * True when the box was laid out as one line. Its width is then the browser's measured text width,
 * which PowerPoint's own metrics can exceed by a little, pushing the last word onto a new line and
 * over whatever sits below. Such text must not wrap. The width estimate keeps genuinely overfull
 * boxes wrapping, because without wrap they would run off the slide.
 */
function isSingleLineBox(el: TextElement): boolean {
  const s = el.style;
  const blocks = el.content.content;
  const only = blocks[0];
  if (blocks.length !== 1 || !only || (only.type !== 'paragraph' && only.type !== 'heading')) {
    return false;
  }
  if (only.content?.some((n) => n.type === 'hardBreak')) return false;
  const inner = el.frame.h - 2 * s.padding;
  if (inner >= s.fontSizePx * s.lineHeight * 1.5) return false;
  let ems = 0;
  for (const ch of plainTextFromDoc(el.content)) ems += ch.charCodeAt(0) >= 0x2e80 ? 1 : 0.55;
  const estimated =
    ems * s.fontSizePx + [...plainTextFromDoc(el.content)].length * s.letterSpacingPx;
  return estimated <= (el.frame.w - 2 * s.padding) * 1.25;
}

function addText(ctx: Ctx, el: TextElement, index: number, target: PptxGenJS.Slide): void {
  const s = el.style;
  const font = s.fontFamily ?? ctx.doc.theme.fontFamily;
  ctx.fonts.add(font);
  const color = pptxColor(s.color ?? ctx.doc.theme.tokens.foreground);
  const fill = solidOf(el.fill);
  if (el.fill && (el.fill.type === 'linear' || el.fill.type === 'radial')) {
    note(ctx, index, 'gradient-text-box', '글자 상자의 그라데이션 배경을 첫 색상으로 변환', el.id);
  }
  const marginPt = ctx.u.points(s.padding);
  target.addText(textRuns(ctx, el) as PptxGenJS.TextProps[], {
    ...box(ctx, el),
    fontFace: font,
    fontSize: ctx.u.points(s.fontSizePx),
    bold: s.fontWeight >= 600,
    italic: s.italic,
    ...(color
      ? { color: color.color, ...(color.transparency ? { transparency: color.transparency } : {}) }
      : {}),
    align: s.align,
    valign: s.valign,
    margin: [marginPt, marginPt, marginPt, marginPt],
    lineSpacingMultiple: s.lineHeight,
    ...(s.letterSpacingPx ? { charSpacing: ctx.u.points(s.letterSpacingPx) } : {}),
    ...(s.paragraphSpacingPx ? { paraSpaceAfter: ctx.u.points(s.paragraphSpacingPx) } : {}),
    ...(fill ? { fill: { color: fill.color, transparency: fill.transparency } } : {}),
    fit: 'none',
    wrap: !isSingleLineBox(el),
    objectName: el.name ?? plainTextFromDoc(el.content).slice(0, 40),
  });
  if (s.fontWeight > 400 && s.fontWeight < 600) {
    note(
      ctx,
      index,
      'font-weight',
      `글자 굵기 ${s.fontWeight}은 PPTX에서 일반 또는 굵게만 표현됩니다.`,
      el.id,
      'info',
    );
  }
  ctx.counts.native++;
}

/* ---- Shape, line, picture ---- */

function shadowProps(el: SlideElement, ctx: Ctx): Record<string, unknown> {
  if (!el.shadow) return {};
  const c = pptxColor(el.shadow.color);
  if (!c) return {};
  const { x, y, blur } = el.shadow;
  const dist = Math.hypot(x, y);
  const angle = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return {
    shadow: {
      type: 'outer',
      color: c.color,
      opacity: 1 - c.transparency / 100,
      blur: ctx.u.points(blur),
      offset: ctx.u.points(dist),
      angle,
    },
  };
}

async function addShape(
  ctx: Ctx,
  el: ShapeElement,
  slide: Slide,
  index: number,
  target: PptxGenJS.Slide,
): Promise<void> {
  if (el.fill.type === 'linear' || el.fill.type === 'radial') {
    // PptxGenJS has no gradient fill API. Keep the look when possible, or say what changed.
    if (await fallbackImage(ctx, el, slide, index, '그라데이션 도형', target)) return;
    note(ctx, index, 'gradient-shape', '그라데이션을 첫 색상으로 변환', el.id);
  }
  const fill = solidOf(el.fill);
  const line = el.stroke && el.stroke.width > 0 ? pptxColor(el.stroke.color) : null;
  const options: Record<string, unknown> = {
    ...box(ctx, el),
    ...(fill
      ? {
          fill: {
            color: fill.color,
            transparency: Math.min(100, fill.transparency + opacityToTransparency(el.opacity)),
          },
        }
      : { fill: { type: 'none' } }),
    ...(line
      ? {
          line: {
            color: line.color,
            width: ctx.u.points(el.stroke!.width),
            dashType: DASH[el.stroke!.dash],
          },
        }
      : {}),
    ...shadowProps(el, ctx),
    objectName: el.name ?? el.shape,
  };
  if (el.shape === 'roundRect') {
    options.rectRadius = Math.min(
      ctx.u.inches(el.radius || 32),
      Math.min(ctx.u.inches(el.frame.w), ctx.u.inches(el.frame.h)) / 2,
    );
  }
  target.addShape(SHAPE[el.shape] as PptxGenJS.ShapeType, options as PptxGenJS.ShapeProps);
  ctx.counts.native++;
}

async function addLine(
  ctx: Ctx,
  el: LineElement,
  slide: Slide,
  index: number,
  target: PptxGenJS.Slide,
): Promise<void> {
  if (el.kind === 'curve') {
    if (await fallbackImage(ctx, el, slide, index, '곡선', target)) return;
    note(ctx, index, 'curve-as-line', '곡선을 직선으로 변환', el.id);
  }
  const { x1, y1, x2, y2 } = el.points;
  const c = pptxColor(el.stroke.color);
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  target.addShape(
    'line' as PptxGenJS.ShapeType,
    {
      x: ctx.u.inches(el.frame.x + left),
      y: ctx.u.inches(el.frame.y + top),
      w: ctx.u.inches(Math.abs(x2 - x1)),
      h: ctx.u.inches(Math.abs(y2 - y1)),
      flipH: x2 < x1,
      flipV: y2 < y1,
      ...(el.frame.rotate ? { rotate: ((el.frame.rotate % 360) + 360) % 360 } : {}),
      line: {
        color: c?.color ?? '000000',
        width: ctx.u.points(el.stroke.width),
        dashType: DASH[el.stroke.dash],
        ...(el.startArrow ? { beginArrowType: 'triangle' } : {}),
        ...(el.endArrow ? { endArrowType: 'triangle' } : {}),
      },
    } as PptxGenJS.ShapeProps,
  );
  ctx.counts.native++;
}

async function addImage(
  ctx: Ctx,
  el: ImageElement,
  index: number,
  target: PptxGenJS.Slide,
): Promise<void> {
  const url = ctx.adapter.assetUrl(el.assetId);
  if (!url) {
    ctx.counts.lost++;
    note(ctx, index, 'image-missing', '이미지 데이터가 없어 넣지 못했습니다.', el.id, 'error');
    return;
  }
  const safe = await safeImage(ctx, url);
  if (!safe) {
    ctx.counts.lost++;
    note(
      ctx,
      index,
      'image-format',
      `이미지 형식(${/^data:([^;]+)/.exec(url)?.[1] ?? '알 수 없음'})을 PPTX용으로 변환하지 못했습니다.`,
      el.id,
      'error',
    );
    return;
  }
  const b = box(ctx, el);
  const options: Record<string, unknown> = {
    data: stripData(safe),
    ...b,
    altText: el.alt || undefined,
    ...(el.opacity !== 1 ? { transparency: opacityToTransparency(el.opacity) } : {}),
  };
  const nw = el.naturalWidth;
  const nh = el.naturalHeight;
  if (el.crop) {
    // PptxGenJS's own crop computes offsets from the placed size, which skews results, so a crop
    // goes through the adapter when it can. Otherwise the whole picture is stretched and reported.
    note(
      ctx,
      index,
      'crop-approx',
      '자르기는 PowerPoint에서 일부 다르게 보일 수 있습니다.',
      el.id,
      'info',
    );
    if (nw && nh) {
      const fullW = el.frame.w / el.crop.w;
      const fullH = el.frame.h / el.crop.h;
      options.w = ctx.u.inches(fullW);
      options.h = ctx.u.inches(fullH);
      options.sizing = {
        type: 'crop',
        x: ctx.u.inches(fullW * el.crop.x),
        y: ctx.u.inches(fullH * el.crop.y),
        w: ctx.u.inches(el.frame.w),
        h: ctx.u.inches(el.frame.h),
      };
    }
  } else if (el.fit !== 'fill' && nw && nh) {
    const boxRatio = el.frame.w / Math.max(1, el.frame.h);
    const imgRatio = nw / nh;
    if (Math.abs(boxRatio - imgRatio) > 0.01) {
      if (el.fit === 'cover') {
        const scale = Math.max(el.frame.w / nw, el.frame.h / nh);
        const fullW = nw * scale;
        const fullH = nh * scale;
        options.w = ctx.u.inches(fullW);
        options.h = ctx.u.inches(fullH);
        options.sizing = {
          type: 'crop',
          x: ctx.u.inches((fullW - el.frame.w) * el.focal.x),
          y: ctx.u.inches((fullH - el.frame.h) * el.focal.y),
          w: b.w,
          h: b.h,
        };
      } else {
        // contain: place the scaled picture centred in the box.
        const scale = Math.min(el.frame.w / nw, el.frame.h / nh);
        const fw = nw * scale;
        const fh = nh * scale;
        options.x = ctx.u.inches(el.frame.x + (el.frame.w - fw) / 2);
        options.y = ctx.u.inches(el.frame.y + (el.frame.h - fh) / 2);
        options.w = ctx.u.inches(fw);
        options.h = ctx.u.inches(fh);
      }
    }
  }
  if (el.radius > 0)
    note(
      ctx,
      index,
      'image-radius',
      '이미지의 둥근 모서리는 PPTX에서 유지되지 않습니다.',
      el.id,
      'info',
    );
  target.addImage(options as PptxGenJS.ImageProps);
  ctx.counts.native++;
}

async function addSvg(
  ctx: Ctx,
  el: SlideElement & { type: 'svg' },
  index: number,
  target: PptxGenJS.Slide,
): Promise<void> {
  const url = ctx.adapter.assetUrl(el.assetId);
  if (!url) {
    ctx.counts.lost++;
    note(ctx, index, 'svg-missing', 'SVG 데이터가 없어 넣지 못했습니다.', el.id, 'error');
    return;
  }
  target.addImage({ data: stripData(url), ...box(ctx, el) } as PptxGenJS.ImageProps);
  ctx.counts.svg++;
}

/* ---- Table, chart, code ---- */

function addTable(ctx: Ctx, el: TableElement, target: PptxGenJS.Slide): void {
  const total = el.columns.reduce((a, b) => a + b, 0);
  const b = box(ctx, el);
  const colW = el.columns.map((c) => (c / total) * b.w);
  const border = el.border && el.border.width > 0 ? pptxColor(el.border.color) : null;
  const borderProp = border
    ? { type: 'solid', color: border.color, pt: ctx.u.points(el.border!.width) }
    : { type: 'none' };
  const font = ctx.doc.theme.fontFamily;
  ctx.fonts.add(font);
  const rows = el.rows.map((row) =>
    row.map((cell) => ({
      text: cell.text,
      options: {
        bold: cell.bold,
        align: cell.align,
        valign: 'middle',
        ...(cell.color
          ? { color: pptxColor(cell.color)?.color }
          : { color: pptxColor(ctx.doc.theme.tokens.foreground)?.color }),
        ...(cell.fill && pptxColor(cell.fill)
          ? { fill: { color: pptxColor(cell.fill)!.color } }
          : {}),
        border: [borderProp, borderProp, borderProp, borderProp],
      },
    })),
  );
  target.addTable(rows as PptxGenJS.TableRow[], {
    x: b.x,
    y: b.y,
    w: b.w,
    colW,
    rowH: b.h / Math.max(1, el.rows.length),
    fontFace: font,
    fontSize: ctx.u.points(el.fontSizePx),
  });
  ctx.counts.native++;
}

const CHART_TYPE: Record<ChartElement['chartType'], string> = {
  bar: 'bar',
  line: 'line',
  pie: 'pie',
  area: 'area',
  scatter: 'scatter',
};

function addChart(ctx: Ctx, el: ChartElement, index: number, target: PptxGenJS.Slide): void {
  const labels = el.categories;
  const nums = (d: (number | null)[]): number[] => d.map((v) => v ?? 0);
  if (el.series.some((s) => s.data.includes(null))) {
    note(ctx, index, 'chart-null', '빈 값은 차트에서 0으로 표시됩니다.', el.id);
  }
  let data: { name: string; labels?: string[]; values: number[] }[];
  if (el.chartType === 'scatter') {
    // PptxGenJS: first entry holds the X values, the rest are Y series.
    data = [
      { name: 'X', values: labels.map((l, i) => (Number.isFinite(Number(l)) ? Number(l) : i + 1)) },
      ...el.series.map((s) => ({ name: s.name, values: nums(s.data) })),
    ];
  } else {
    data = el.series.map((s) => ({ name: s.name, labels, values: nums(s.data) }));
  }
  const palette = ['2563EB', '16A34A', 'F59E0B', 'DC2626', '7C3AED', '0891B2', 'DB2777', '65A30D'];
  // A pie colours its points, not its series, so a single series colour would paint every slice alike.
  const colors =
    el.chartType === 'pie'
      ? labels.map((_, i) => palette[i % palette.length]!)
      : el.series.map((s, i) => pptxColor(s.color)?.color ?? palette[i % palette.length]!);
  const size = ctx.u.points(el.fontSizePx);
  target.addChart(CHART_TYPE[el.chartType] as PptxGenJS.CHART_NAME, data, {
    ...box(ctx, el),
    chartColors: colors,
    showLegend: el.legend,
    legendPos: 'b',
    legendFontSize: size,
    catAxisLabelFontSize: size,
    valAxisLabelFontSize: size,
    ...(el.title
      ? { showTitle: true, title: el.title, titleFontSize: size * 1.2 }
      : { showTitle: false }),
    ...(el.xAxisTitle ? { showCatAxisTitle: true, catAxisTitle: el.xAxisTitle } : {}),
    ...(el.yAxisTitle ? { showValAxisTitle: true, valAxisTitle: el.yAxisTitle } : {}),
    ...(el.chartType === 'pie' ? { showPercent: true, showValue: false } : {}),
  } as PptxGenJS.IChartOpts);
  ctx.counts.native++;
}

function addCode(ctx: Ctx, el: CodeElement, target: PptxGenJS.Slide): void {
  const lines = el.tokens ?? el.code.split('\n').map((text) => [{ text }]);
  const base = pptxColor(el.color)?.color;
  const runs = lines.flatMap((line, i) => {
    const parts = line.length ? line : [{ text: ' ' }];
    return parts.map((t, j) => ({
      text: t.text,
      options: {
        color: pptxColor((t as { color?: string }).color)?.color ?? base,
        ...(j === parts.length - 1 && i < lines.length - 1 ? { breakLine: true } : {}),
      },
    }));
  });
  const bg = pptxColor(el.background);
  const pad = ctx.u.points(32);
  target.addText(runs as PptxGenJS.TextProps[], {
    ...box(ctx, el),
    fontFace: 'Consolas',
    fontSize: ctx.u.points(el.fontSizePx),
    valign: 'top',
    margin: [pad, pad, pad, pad],
    ...(bg ? { fill: { color: bg.color } } : {}),
    wrap: false,
  });
  ctx.counts.native++;
}

async function addElement(
  ctx: Ctx,
  el: SlideElement,
  slide: Slide,
  index: number,
  target: PptxGenJS.Slide,
): Promise<void> {
  ctx.counts.elements++;
  switch (el.type) {
    case 'text':
      addText(ctx, el, index, target);
      break;
    case 'shape':
      await addShape(ctx, el, slide, index, target);
      break;
    case 'line':
      await addLine(ctx, el, slide, index, target);
      break;
    case 'image':
      await addImage(ctx, el, index, target);
      break;
    case 'svg':
      await addSvg(ctx, el, index, target);
      break;
    case 'table':
      addTable(ctx, el, target);
      break;
    case 'chart':
      addChart(ctx, el, index, target);
      break;
    case 'code':
      addCode(ctx, el, target);
      break;
  }
  if (el.shadow && el.type !== 'shape') {
    note(
      ctx,
      index,
      'shadow-dropped',
      `${el.type} 요소의 그림자는 PPTX에서 유지되지 않습니다.`,
      el.id,
      'info',
    );
  }
  if (el.opacity !== 1 && el.type !== 'shape' && el.type !== 'image') {
    note(
      ctx,
      index,
      'opacity-dropped',
      `${el.type} 요소의 투명도는 PPTX에서 유지되지 않습니다.`,
      el.id,
      'info',
    );
  }
}

async function applyBackground(
  ctx: Ctx,
  slide: Slide,
  index: number,
  target: PptxGenJS.Slide,
): Promise<void> {
  const bg = slide.background;
  if (bg.type === 'solid') {
    const c = pptxColor(bg.color);
    if (c) target.background = { color: c.color };
    return;
  }
  if (bg.type === 'image') {
    const url = ctx.adapter.assetUrl(bg.assetId);
    const safe = url && (await safeImage(ctx, url));
    if (safe) {
      target.background = { data: stripData(safe) };
      if (bg.overlay) {
        const c = pptxColor(bg.overlay);
        if (c) {
          target.addShape('rect' as PptxGenJS.ShapeType, {
            x: 0,
            y: 0,
            w: ctx.u.widthIn,
            h: ctx.u.heightIn,
            fill: { color: c.color, transparency: c.transparency },
          });
        }
      }
    } else {
      ctx.counts.lost++;
      note(ctx, index, 'bg-missing', '배경 이미지를 넣지 못했습니다.', undefined, 'error');
    }
    return;
  }
  // Gradient backgrounds have no API: use a rendered picture of the slide background alone.
  const plain: Slide = { ...slide, elements: [] };
  const raster = await ctx.adapter.rasterizeSlide?.(plain, index);
  if (raster) {
    target.background = { data: stripData(raster) };
    ctx.counts.imageFallback++;
    note(ctx, index, 'gradient-bg', '그라데이션 배경 → 이미지로 변환');
  } else {
    const first = pptxColor(bg.stops[0]?.color);
    if (first) target.background = { color: first.color };
    note(ctx, index, 'gradient-bg-flat', '그라데이션 배경을 첫 색상으로 변환');
  }
}

/**
 * Build a PPTX. `editable` maps to native objects where possible; `fidelity` places one picture per
 * slide. Neither claims PowerPoint will render identically to HTML (plan §7).
 */
export async function buildPptx(
  doc: DeckDocument,
  adapter: PptxAdapter,
  opts: { mode: PptxMode; now?: () => Date },
): Promise<PptxResult> {
  const u = createUnitConverter(doc.page);
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'HPS', width: u.widthIn, height: u.heightIn });
  pptx.layout = 'HPS';
  pptx.title = doc.meta.title;
  pptx.theme = { headFontFace: doc.theme.fontFamily, bodyFontFace: doc.theme.fontFamily };

  const ctx: Ctx = { doc, pptx, adapter, items: [], counts: emptyCounts(), fonts: new Set(), u };
  if (opts.mode === 'fidelity' && !adapter.rasterizeSlide) {
    throw new Error('외관 우선 모드에는 슬라이드 캡처 기능이 필요합니다.');
  }

  for (const [index, slide] of doc.slides.entries()) {
    const target = pptx.addSlide();
    ctx.counts.slides++;
    if (slide.hidden) target.hidden = true;
    if (slide.notes) target.addNotes(slide.notes);

    if (opts.mode === 'fidelity') {
      const png = await adapter.rasterizeSlide!(slide, index);
      ctx.counts.elements += slide.elements.length;
      if (png) {
        target.addImage({ data: stripData(png), x: 0, y: 0, w: u.widthIn, h: u.heightIn });
        ctx.counts.imageFallback++;
      } else {
        ctx.counts.lost += slide.elements.length;
        note(
          ctx,
          index,
          'capture-failed',
          '슬라이드 캡처에 실패해 빈 슬라이드가 되었습니다.',
          undefined,
          'error',
        );
      }
      continue;
    }

    await applyBackground(ctx, slide, index, target);
    const ordered = [...slide.elements].sort((a, b) => a.zIndex - b.zIndex);
    for (const el of ordered) {
      if (el.hidden) continue;
      await addElement(ctx, el, slide, index, target);
    }
  }

  const buffer = (await pptx.write({ outputType: 'arraybuffer' })) as ArrayBuffer;
  return {
    bytes: new Uint8Array(buffer),
    report: {
      format: 'pptx',
      mode: opts.mode,
      generatedAt: (opts.now?.() ?? new Date()).toISOString(),
      counts: ctx.counts,
      fontsUsed: [...ctx.fonts],
      items: ctx.items,
    },
  };
}
