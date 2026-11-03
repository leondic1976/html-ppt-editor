import {
  applyCommands,
  createDocument,
  createShapeElement,
  createSlide,
  createTextElement,
  docFromPlainText,
  type DeckDocument,
  type Slide,
  type SlideBackground,
  type SlideElement,
} from '@hps/document-core';

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  background: SlideBackground;
  foreground: string;
  accent: string;
  /** Layout that opens the deck. */
  cover: LayoutId;
}

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'blank',
    name: '빈 문서',
    description: '흰 배경',
    background: { type: 'solid', color: '#ffffff' },
    foreground: '#0f172a',
    accent: '#2563eb',
    cover: 'blank',
  },
  {
    id: 'report',
    name: '보고서',
    description: '밝은 배경에 파란 강조',
    background: { type: 'solid', color: '#ffffff' },
    foreground: '#0f172a',
    accent: '#1d4ed8',
    cover: 'title',
  },
  {
    id: 'lecture',
    name: '강의',
    description: '따뜻한 종이 느낌',
    background: { type: 'solid', color: '#fbf7ef' },
    foreground: '#292524',
    accent: '#b45309',
    cover: 'title',
  },
  {
    id: 'product',
    name: '제품 소개',
    description: '어두운 그라데이션',
    background: {
      type: 'linear',
      angle: 135,
      stops: [
        { offset: 0, color: '#0f172a' },
        { offset: 1, color: '#312e81' },
      ],
    },
    foreground: '#f8fafc',
    accent: '#38bdf8',
    cover: 'title',
  },
];

export type LayoutId = 'blank' | 'title' | 'titleBody' | 'twoColumn' | 'imageText' | 'section';

export const LAYOUTS: { id: LayoutId; name: string }[] = [
  { id: 'titleBody', name: '제목 + 본문' },
  { id: 'title', name: '표지' },
  { id: 'section', name: '구역 제목' },
  { id: 'twoColumn', name: '2단' },
  { id: 'imageText', name: '사진 자리 + 글' },
  { id: 'blank', name: '빈 슬라이드' },
];

const text = (
  value: string,
  x: number,
  y: number,
  w: number,
  h: number,
  size: number,
  weight: number,
  color: string,
  z: number,
  align: 'left' | 'center' = 'left',
  valign: 'top' | 'middle' = 'top',
): SlideElement => {
  const el = createTextElement(value, { x, y, w, h });
  el.style = { ...el.style, fontSizePx: size, fontWeight: weight, color, align, valign };
  el.zIndex = z;
  return el;
};

export function layoutElements(layout: LayoutId, doc: DeckDocument): SlideElement[] {
  const fg = doc.theme.tokens.foreground;
  const accent = doc.theme.tokens.accent;
  const bar = (): SlideElement => {
    const s = createShapeElement('rect', { x: 120, y: 252, w: 160, h: 10 });
    s.fill = { type: 'solid', color: accent };
    s.zIndex = 0;
    return s;
  };
  switch (layout) {
    case 'blank':
      return [];
    case 'title':
      return [
        text('발표 제목을 입력하세요', 160, 340, 1600, 220, 104, 700, fg, 1, 'center', 'middle'),
        text('발표자 · 날짜', 160, 590, 1600, 90, 44, 400, fg, 2, 'center'),
      ];
    case 'section':
      return [text('구역 제목', 160, 400, 1600, 240, 96, 700, accent, 1, 'left', 'middle')];
    case 'titleBody':
      return [
        text('제목', 120, 90, 1680, 150, 72, 700, fg, 1),
        bar(),
        text('본문 내용을 입력하세요', 120, 300, 1680, 680, 44, 400, fg, 2),
      ];
    case 'twoColumn':
      return [
        text('제목', 120, 90, 1680, 150, 72, 700, fg, 1),
        bar(),
        text('왼쪽 내용', 120, 300, 800, 680, 40, 400, fg, 2),
        text('오른쪽 내용', 1000, 300, 800, 680, 40, 400, fg, 3),
      ];
    case 'imageText': {
      const box = createShapeElement('roundRect', { x: 120, y: 240, w: 800, h: 680 });
      box.fill = { type: 'solid', color: '#cbd5e1' };
      box.name = '사진 자리';
      box.zIndex = 2;
      return [
        text('제목', 120, 70, 1680, 140, 72, 700, fg, 1),
        box,
        text('설명 내용을 입력하세요', 1000, 240, 800, 680, 40, 400, fg, 3),
      ];
    }
  }
}

export function slideFromLayout(
  layout: LayoutId,
  doc: DeckDocument,
  background: SlideBackground,
): Slide {
  return { ...createSlide(doc.theme), background, elements: layoutElements(layout, doc) };
}

export function createFromTemplate(tpl: TemplateDef, title?: string): DeckDocument {
  const base = createDocument({ title: title ?? tpl.name, slideCount: 0 });
  const doc: DeckDocument = {
    ...base,
    theme: {
      ...base.theme,
      tokens: {
        background: tpl.background.type === 'solid' ? tpl.background.color : '#ffffff',
        foreground: tpl.foreground,
        accent: tpl.accent,
      },
    },
  };
  return applyCommands(doc, [
    { type: 'slide.add', slide: slideFromLayout(tpl.cover, doc, tpl.background) },
  ]).doc;
}

/** Small realistic deck for the demo. Nothing in it claims measured results. */
export function createDemoDeck(): DeckDocument {
  const tpl = TEMPLATES[3]!;
  const doc = createFromTemplate(tpl, '데모 발표자료');
  const slide = slideFromLayout('titleBody', doc, tpl.background);
  const body = slide.elements[2]!;
  if (body.type === 'text')
    body.content = docFromPlainText(
      '텍스트, 사진, 도형, 표, 차트를 직접 편집해 보세요.\n더블클릭으로 글자를 고칩니다.',
    );
  return applyCommands(doc, [{ type: 'slide.add', slide }]).doc;
}
