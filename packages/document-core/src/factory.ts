import { newId } from './ids.js';
import { docFromPlainText } from './text.js';
import { DeckDocument, Slide, SlideElement } from './schema.js';
import type {
  ChartElement,
  CodeElement,
  ElementType,
  Frame,
  LineElement,
  ShapeElement,
  ShapeKind,
  TableElement,
  TextElement,
} from './schema.js';

export interface NewDocOptions {
  title?: string;
  locale?: string;
  slideCount?: number;
  appVersion?: string;
}

export function createSlide(theme?: DeckDocument['theme']): Slide {
  return Slide.parse({
    id: newId('slide'),
    background: { type: 'solid', color: theme?.tokens.background ?? '#ffffff' },
    elements: [],
  });
}

export function createDocument(opts: NewDocOptions = {}): DeckDocument {
  const base = DeckDocument.parse({
    formatVersion: 2,
    docId: newId('doc'),
    appVersion: opts.appVersion ?? '0.1.0',
    meta: { title: opts.title ?? '제목 없음', locale: opts.locale ?? 'ko-KR' },
    page: {},
    theme: {},
    slides: [],
  });
  const n = opts.slideCount ?? 1;
  return { ...base, slides: Array.from({ length: n }, () => createSlide(base.theme)) };
}

const defaultFrame = (w: number, h: number, page = { width: 1920, height: 1080 }): Frame => ({
  x: Math.round((page.width - w) / 2),
  y: Math.round((page.height - h) / 2),
  w,
  h,
  rotate: 0,
});

export function createTextElement(
  text = '텍스트를 입력하세요',
  frame?: Partial<Frame>,
): TextElement {
  return SlideElement.parse({
    id: newId('el'),
    type: 'text',
    frame: { ...defaultFrame(1000, 160), ...frame },
    content: docFromPlainText(text),
    style: { fontSizePx: 56 },
  }) as TextElement;
}

export function createShapeElement(
  shape: ShapeKind = 'rect',
  frame?: Partial<Frame>,
): ShapeElement {
  return SlideElement.parse({
    id: newId('el'),
    type: 'shape',
    shape,
    radius: shape === 'roundRect' ? 32 : 0,
    frame: { ...defaultFrame(480, 320), ...frame },
    fill: { type: 'solid', color: '#2563eb' },
  }) as ShapeElement;
}

export function createLineElement(frame?: Partial<Frame>): LineElement {
  const f = { ...defaultFrame(600, 4), ...frame };
  return SlideElement.parse({
    id: newId('el'),
    type: 'line',
    frame: f,
    points: { x1: 0, y1: f.h / 2, x2: f.w, y2: f.h / 2 },
    stroke: { color: '#0f172a', width: 6 },
  }) as LineElement;
}

export function createTableElement(frame?: Partial<Frame>): TableElement {
  const header = ['항목', '값 A', '값 B'];
  return SlideElement.parse({
    id: newId('el'),
    type: 'table',
    frame: { ...defaultFrame(1100, 400), ...frame },
    columns: [2, 1, 1],
    rows: [
      header.map((text) => ({ text, bold: true, fill: '#e2e8f0' })),
      ['첫째', '10', '20'].map((text) => ({ text })),
      ['둘째', '30', '40'].map((text) => ({ text })),
    ],
    border: { color: '#94a3b8', width: 2 },
  }) as TableElement;
}

export function createChartElement(frame?: Partial<Frame>): ChartElement {
  return SlideElement.parse({
    id: newId('el'),
    type: 'chart',
    chartType: 'bar',
    frame: { ...defaultFrame(1200, 640), ...frame },
    title: '차트 제목',
    categories: ['1분기', '2분기', '3분기', '4분기'],
    series: [{ name: '매출', data: [12, 19, 23, 31], color: '#2563eb' }],
  }) as ChartElement;
}

export function createCodeElement(frame?: Partial<Frame>): CodeElement {
  return SlideElement.parse({
    id: newId('el'),
    type: 'code',
    frame: { ...defaultFrame(1100, 420), ...frame },
    code: "function hello() {\n  console.log('안녕하세요');\n}",
    language: 'javascript',
  }) as CodeElement;
}

export const DEFAULT_CREATORS: Partial<Record<ElementType, () => SlideElement>> = {
  text: () => createTextElement(),
  shape: () => createShapeElement(),
  line: () => createLineElement(),
  table: () => createTableElement(),
  chart: () => createChartElement(),
  code: () => createCodeElement(),
};
