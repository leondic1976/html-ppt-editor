import { z } from 'zod';

export const CURRENT_FORMAT_VERSION = 2;

const finite = z.number().finite();
/** Hex (#rgb, #rrggbb, #rrggbbaa) or the literal `transparent`. Never free-form CSS: values reach style attributes. */
export const Color = z
  .string()
  .regex(/^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|transparent)$/, 'expected #hex colour');
export type Color = z.infer<typeof Color>;

export const AssetId = z.string().regex(/^sha256-[0-9a-f]{64}$/, 'expected sha256-<hex>');
const Id = z.string().min(1).max(128);
/** A font-family name; quoted when rendered, so CSS-significant characters are refused. */
const FontName = z
  .string()
  .max(120)
  .regex(/^[^"'\\;{}<>]*$/, 'font name contains forbidden characters');

export const Frame = z.object({
  x: finite,
  y: finite,
  w: finite.nonnegative(),
  h: finite.nonnegative(),
  rotate: finite.default(0),
});
export type Frame = z.infer<typeof Frame>;

export const GradientStop = z.object({ offset: finite.min(0).max(1), color: Color });
export const Fill = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('solid'), color: Color }),
  z.object({
    type: z.literal('linear'),
    angle: finite,
    stops: z.array(GradientStop).min(2).max(16),
  }),
  z.object({ type: z.literal('radial'), stops: z.array(GradientStop).min(2).max(16) }),
]);
export type Fill = z.infer<typeof Fill>;

export const Stroke = z.object({
  color: Color,
  width: finite.nonnegative(),
  dash: z.enum(['solid', 'dashed', 'dotted']).default('solid'),
});
export type Stroke = z.infer<typeof Stroke>;

export const Shadow = z.object({
  x: finite,
  y: finite,
  blur: finite.nonnegative(),
  color: Color,
});
export type Shadow = z.infer<typeof Shadow>;

const ElementBase = z.object({
  id: Id,
  name: z.string().max(200).optional(),
  frame: Frame,
  zIndex: z.number().int().default(0),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  opacity: finite.min(0).max(1).default(1),
  groupId: Id.optional(),
  shadow: Shadow.optional(),
});

/* ---- Rich text: a ProseMirror-compatible JSON subset with no dependency on TipTap. ---- */
export const TextMark = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bold') }),
  z.object({ type: z.literal('italic') }),
  z.object({ type: z.literal('underline') }),
  z.object({ type: z.literal('strike') }),
  z.object({ type: z.literal('code') }),
  z.object({
    type: z.literal('link'),
    attrs: z.object({ href: z.string().max(2048) }).loose(),
  }),
  z.object({
    type: z.literal('textStyle'),
    attrs: z
      .object({
        color: Color.nullish(),
        fontSizePx: finite.positive().nullish(),
        fontFamily: FontName.nullish(),
      })
      .loose(),
  }),
]);
export type TextMark = z.infer<typeof TextMark>;

export type RichNode =
  | { type: 'text'; text: string; marks?: TextMark[] }
  | { type: 'hardBreak' }
  | { type: 'paragraph'; attrs?: { textAlign?: string | null }; content?: RichNode[] }
  | { type: 'heading'; attrs?: { level?: number; textAlign?: string | null }; content?: RichNode[] }
  | { type: 'bulletList' | 'orderedList'; attrs?: Record<string, unknown>; content?: RichNode[] }
  | { type: 'listItem'; content?: RichNode[] };

const inlineNode: z.ZodType<RichNode> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal('text'),
      text: z.string().max(1_000_000),
      marks: z.array(TextMark).optional(),
    }),
    z.object({ type: z.literal('hardBreak') }),
  ]),
) as z.ZodType<RichNode>;

const blockNode: z.ZodType<RichNode> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal('paragraph'),
      attrs: z.object({ textAlign: z.string().nullish() }).loose().optional(),
      content: z.array(inlineNode).optional(),
    }),
    z.object({
      type: z.literal('heading'),
      attrs: z
        .object({
          level: z.number().int().min(1).max(6).optional(),
          textAlign: z.string().nullish(),
        })
        .loose()
        .optional(),
      content: z.array(inlineNode).optional(),
    }),
    z.object({
      type: z.enum(['bulletList', 'orderedList']),
      attrs: z.record(z.string(), z.unknown()).optional(),
      content: z.array(blockNode).optional(),
    }),
    z.object({ type: z.literal('listItem'), content: z.array(blockNode).optional() }),
  ]),
) as z.ZodType<RichNode>;

export const RichDoc = z.object({ type: z.literal('doc'), content: z.array(blockNode) });
export type RichDoc = z.infer<typeof RichDoc>;

export const TextStyle = z.object({
  fontFamily: FontName.optional(),
  fontSizePx: finite.positive().default(40),
  lineHeight: finite.positive().default(1.3),
  fontWeight: z.number().int().min(100).max(900).default(400),
  italic: z.boolean().default(false),
  color: Color.optional(),
  align: z.enum(['left', 'center', 'right', 'justify']).default('left'),
  valign: z.enum(['top', 'middle', 'bottom']).default('top'),
  letterSpacingPx: finite.default(0),
  paragraphSpacingPx: finite.nonnegative().default(0),
  padding: finite.nonnegative().default(0),
});
export type TextStyle = z.infer<typeof TextStyle>;

export const TextElement = ElementBase.extend({
  type: z.literal('text'),
  content: RichDoc,
  style: TextStyle,
  fill: Fill.optional(),
});
export type TextElement = z.infer<typeof TextElement>;

export const ImageElement = ElementBase.extend({
  type: z.literal('image'),
  assetId: AssetId,
  alt: z.string().max(2000).default(''),
  fit: z.enum(['cover', 'contain', 'fill']).default('cover'),
  /** Focal point (0..1) used as object-position. */
  focal: z.object({ x: finite.min(0).max(1), y: finite.min(0).max(1) }).default({ x: 0.5, y: 0.5 }),
  /** Crop rectangle in source-image fractions. */
  crop: z
    .object({
      x: finite.min(0).max(1),
      y: finite.min(0).max(1),
      w: finite.min(0).max(1),
      h: finite.min(0).max(1),
    })
    .optional(),
  naturalWidth: finite.positive().optional(),
  naturalHeight: finite.positive().optional(),
  radius: finite.nonnegative().default(0),
  stroke: Stroke.optional(),
});
export type ImageElement = z.infer<typeof ImageElement>;

export const SvgElement = ElementBase.extend({
  type: z.literal('svg'),
  assetId: AssetId,
  alt: z.string().max(2000).default(''),
});
export type SvgElement = z.infer<typeof SvgElement>;

export const ShapeKind = z.enum([
  'rect',
  'roundRect',
  'ellipse',
  'triangle',
  'diamond',
  'chevron',
  'arrowRight',
]);
export type ShapeKind = z.infer<typeof ShapeKind>;

export const ShapeElement = ElementBase.extend({
  type: z.literal('shape'),
  shape: ShapeKind,
  fill: Fill,
  stroke: Stroke.optional(),
  radius: finite.nonnegative().default(0),
});
export type ShapeElement = z.infer<typeof ShapeElement>;

export const LineElement = ElementBase.extend({
  type: z.literal('line'),
  kind: z.enum(['straight', 'curve']).default('straight'),
  /** Endpoints in the element's local coordinates (0..frame.w, 0..frame.h). */
  points: z.object({ x1: finite, y1: finite, x2: finite, y2: finite }),
  stroke: Stroke,
  startArrow: z.boolean().default(false),
  endArrow: z.boolean().default(false),
});
export type LineElement = z.infer<typeof LineElement>;

export const TableCell = z.object({
  text: z.string().max(100_000).default(''),
  bold: z.boolean().default(false),
  align: z.enum(['left', 'center', 'right']).default('left'),
  color: Color.optional(),
  fill: Color.optional(),
});
export type TableCell = z.infer<typeof TableCell>;

export const TableElement = ElementBase.extend({
  type: z.literal('table'),
  /** Relative column widths; normalised on render. */
  columns: z.array(finite.positive()).min(1).max(100),
  rows: z.array(z.array(TableCell)).min(1).max(1000),
  fontSizePx: finite.positive().default(28),
  border: Stroke.optional(),
});
export type TableElement = z.infer<typeof TableElement>;

export const ChartType = z.enum(['bar', 'line', 'pie', 'area', 'scatter']);
export type ChartType = z.infer<typeof ChartType>;

export const ChartElement = ElementBase.extend({
  type: z.literal('chart'),
  chartType: ChartType,
  title: z.string().max(500).optional(),
  categories: z.array(z.string().max(200)).max(5000),
  series: z
    .array(
      z.object({
        name: z.string().max(200),
        data: z.array(finite.nullable()).max(5000),
        color: Color.optional(),
      }),
    )
    .min(1)
    .max(50),
  legend: z.boolean().default(true),
  xAxisTitle: z.string().max(200).optional(),
  yAxisTitle: z.string().max(200).optional(),
  unit: z.string().max(40).optional(),
  fontSizePx: finite.positive().default(24),
  /** Pre-rendered, app-generated SVG asset so exported files need no chart runtime. */
  renderedAssetId: AssetId.optional(),
});
export type ChartElement = z.infer<typeof ChartElement>;

export const CodeToken = z.object({ text: z.string(), color: Color.optional() });
export const CodeElement = ElementBase.extend({
  type: z.literal('code'),
  code: z.string().max(1_000_000),
  language: z.string().max(40).default('text'),
  /** Static highlighting as structured tokens: no raw HTML ever enters the document. */
  tokens: z.array(z.array(CodeToken)).optional(),
  fontSizePx: finite.positive().default(26),
  background: Color.default('#0f172a'),
  color: Color.default('#e2e8f0'),
});
export type CodeElement = z.infer<typeof CodeElement>;

export const SlideElement = z.discriminatedUnion('type', [
  TextElement,
  ImageElement,
  SvgElement,
  ShapeElement,
  LineElement,
  TableElement,
  ChartElement,
  CodeElement,
]);
export type SlideElement = z.infer<typeof SlideElement>;
export type ElementType = SlideElement['type'];

export const SlideBackground = z.discriminatedUnion('type', [
  z.object({ type: z.literal('solid'), color: Color }),
  z.object({
    type: z.literal('linear'),
    angle: finite,
    stops: z.array(GradientStop).min(2).max(16),
  }),
  z.object({ type: z.literal('radial'), stops: z.array(GradientStop).min(2).max(16) }),
  z.object({
    type: z.literal('image'),
    assetId: AssetId,
    fit: z.enum(['cover', 'contain']).default('cover'),
    /** Optional translucent wash above the image. */
    overlay: Color.optional(),
  }),
]);
export type SlideBackground = z.infer<typeof SlideBackground>;

export const Slide = z.object({
  id: Id,
  section: z.string().max(200).optional(),
  hidden: z.boolean().default(false),
  background: SlideBackground,
  notes: z.string().max(200_000).default(''),
  elements: z.array(SlideElement).max(20_000),
});
export type Slide = z.infer<typeof Slide>;

export const AssetMeta = z.object({
  kind: z.enum(['image', 'svg', 'font']),
  mime: z.string().max(100),
  size: z.number().int().nonnegative(),
  source: z.enum(['embedded', 'external']).default('embedded'),
  name: z.string().max(300).optional(),
  width: finite.positive().optional(),
  height: finite.positive().optional(),
  /** Required for source=external. Only https is accepted; surfaced in offline reports. */
  url: z.url({ protocol: /^https$/ }).optional(),
  /** Licence note for embedded fonts. */
  license: z.string().max(200).optional(),
});
export type AssetMeta = z.infer<typeof AssetMeta>;

export const Theme = z.object({
  /** Installed on Windows, so HTML and PPTX agree by default. Pretendard is offered as a choice. */
  fontFamily: FontName.default('Malgun Gothic'),
  fontFallback: z
    .array(FontName)
    .max(10)
    .default(['Apple SD Gothic Neo', 'Noto Sans KR', 'Arial', 'sans-serif']),
  tokens: z
    .object({ background: Color, foreground: Color, accent: Color })
    .default({ background: '#ffffff', foreground: '#0f172a', accent: '#2563eb' }),
});
export type Theme = z.infer<typeof Theme>;

export const Page = z.object({
  width: finite.positive().default(1920),
  height: finite.positive().default(1080),
  unit: z.literal('model-px').default('model-px'),
  ratio: z.string().max(20).default('16:9'),
});
export type Page = z.infer<typeof Page>;

export const DeckDocument = z.object({
  formatVersion: z.literal(CURRENT_FORMAT_VERSION),
  docId: Id,
  appVersion: z.string().max(40).default('0.0.0'),
  rendererVersion: z.string().max(40).default('1'),
  lastSavedAt: z.string().max(40).nullish(),
  migrationHistory: z
    .array(z.object({ from: z.number(), to: z.number(), at: z.string() }))
    .default([]),
  meta: z.object({
    title: z.string().max(500).default('제목 없음'),
    locale: z.string().max(20).default('ko-KR'),
  }),
  page: Page,
  theme: Theme,
  assets: z.record(AssetId, AssetMeta).default({}),
  slides: z.array(Slide).max(5000),
  /** Reserved. Legacy (mode B) sessions live outside the native model. */
  legacy: z.null().default(null),
});
export type DeckDocument = z.infer<typeof DeckDocument>;
