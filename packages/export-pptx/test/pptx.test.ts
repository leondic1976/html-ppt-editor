import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  applyCommands,
  assetIdFor,
  createChartElement,
  createCodeElement,
  createDocument,
  createLineElement,
  createShapeElement,
  createTableElement,
  createTextElement,
  SlideElement,
  type DeckDocument,
} from '@hps/document-core';
import { buildPptx, pptxColor, type PptxAdapter } from '@hps/export-pptx';
import { formatReport } from '@hps/export-report';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const pngUrl = `data:image/png;base64,${PNG}`;

async function deck(): Promise<{ doc: DeckDocument; adapter: PptxAdapter; assetId: string }> {
  const assetId = await assetIdFor(
    Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0)) as BufferSource,
  );
  let doc = createDocument({ title: '테스트', slideCount: 3 });
  const [a, b, c] = doc.slides;
  const text = createTextElement('한글과 English 혼합 123', { x: 144, y: 144, w: 1440, h: 288 });
  text.style.fontSizePx = 100;
  text.style.letterSpacingPx = 4;
  const img = SlideElement.parse({
    id: 'img',
    type: 'image',
    assetId,
    frame: { x: 0, y: 0, w: 288, h: 144 },
    naturalWidth: 100,
    naturalHeight: 100,
  });
  doc = applyCommands(doc, [
    {
      type: 'asset.add',
      id: assetId,
      meta: { kind: 'image', mime: 'image/png', size: 70, source: 'embedded' },
    },
    { type: 'element.add', slideId: a!.id, element: text },
    { type: 'element.add', slideId: a!.id, element: img },
    { type: 'slide.update', slideId: a!.id, patch: { notes: '발표자 노트 내용' } },
    { type: 'element.add', slideId: b!.id, element: createShapeElement('roundRect') },
    { type: 'element.add', slideId: b!.id, element: createLineElement() },
    { type: 'element.add', slideId: b!.id, element: createTableElement() },
    { type: 'element.add', slideId: c!.id, element: createChartElement() },
    { type: 'element.add', slideId: c!.id, element: createCodeElement() },
  ]).doc;
  return { doc, assetId, adapter: { assetUrl: (id) => (id === assetId ? pngUrl : undefined) } };
}

const open = async (bytes: Uint8Array) => {
  const zip = await JSZip.loadAsync(bytes);
  const read = (p: string) => zip.file(p)!.async('string');
  return { zip, read, names: Object.keys(zip.files) };
};

describe('editable PPTX', () => {
  it('keeps one-line text on one line, because PowerPoint metrics can exceed the browser width', async () => {
    let doc = createDocument({ title: '줄바꿈', slideCount: 1 });
    const slideId = doc.slides[0]!.id;
    const make = (text: string, w: number, h: number) => {
      const el = createTextElement(text, { x: 0, y: 0, w, h });
      el.style.fontSizePx = 96;
      el.style.lineHeight = 1.3;
      el.style.padding = 0;
      return el;
    };
    doc = applyCommands(doc, [
      // Seen in real PowerPoint: a box exactly as wide as the title wrapped its last character.
      { type: 'element.add', slideId, element: make('2026년 사업 계획 발표', 996, 128) },
      { type: 'element.add', slideId, element: make('여러 줄로 쓰도록 만든 상자', 996, 400) },
      {
        type: 'element.add',
        slideId,
        element: make('한 줄 높이지만 상자보다 훨씬 긴 글자입니다 정말로 깁니다', 400, 128),
      },
    ]).doc;
    const { bytes } = await buildPptx(doc, { assetUrl: () => undefined }, { mode: 'editable' });
    const xml = await (await open(bytes)).read('ppt/slides/slide1.xml');
    const bodies = xml.match(/<a:bodyPr[^>]*>/g) ?? [];
    expect(bodies).toHaveLength(3);
    expect(bodies[0]).toContain('wrap="none"');
    expect(bodies[1]).toContain('wrap="square"');
    expect(bodies[2]).toContain('wrap="square"');
  });

  it('exports lists as real bullets and numbers, indented as the renderer indents them', async () => {
    let doc = createDocument({ title: '목록', slideCount: 1 });
    const slideId = doc.slides[0]!.id;
    const make = (type: 'bulletList' | 'orderedList') => {
      const el = createTextElement('', { x: 0, y: 0, w: 800, h: 200 });
      el.style.fontSizePx = 100;
      el.content = {
        type: 'doc',
        content: [
          {
            type,
            content: ['하나', '둘'].map((text) => ({
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
            })),
          },
        ],
      };
      return el;
    };
    doc = applyCommands(doc, [
      { type: 'element.add', slideId, element: make('bulletList') },
      { type: 'element.add', slideId, element: make('orderedList') },
    ]).doc;
    const { bytes } = await buildPptx(doc, { assetUrl: () => undefined }, { mode: 'editable' });
    const xml = await (await open(bytes)).read('ppt/slides/slide1.xml');
    expect(xml.match(/<a:buChar /g)).toHaveLength(2);
    expect(xml.match(/<a:buAutoNum /g)).toHaveLength(2);
    // 100 model px = 50pt; 1.4em = 70pt = 889000 EMU.
    expect(xml.match(/marL="889000"/g)).toHaveLength(4);
  });

  it('is a real OOXML package with the expected slides', async () => {
    const { doc, adapter } = await deck();
    const { bytes } = await buildPptx(doc, adapter, { mode: 'editable' });
    const { names, read } = await open(bytes);
    expect(names).toContain('[Content_Types].xml');
    expect(names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))).toHaveLength(3);
    expect(await read('ppt/presentation.xml')).toContain('cx="12192000"');
  });

  it('text is a native run at the contract size and position', async () => {
    const { doc, adapter } = await deck();
    const { read } = await open((await buildPptx(doc, adapter, { mode: 'editable' })).bytes);
    const xml = await read('ppt/slides/slide1.xml');
    expect(xml).toContain('한글과 English 혼합 123');
    expect(xml).toContain('sz="5000"'); // fontSizePx 100 -> 50pt
    expect(xml).toContain('<a:off x="914400" y="914400"/>'); // 144 model-px -> 1in
    expect(xml).toContain('cx="9144000"'); // 1440 model-px -> 10in
    expect(xml).toContain('spc="200"'); // 4 model-px -> 2pt
  });

  it('writes speaker notes', async () => {
    const { doc, adapter } = await deck();
    const { read, names } = await open((await buildPptx(doc, adapter, { mode: 'editable' })).bytes);
    const notes = names.filter((n) => /notesSlides\/notesSlide\d+\.xml$/.test(n));
    const all = await Promise.all(notes.map(read));
    expect(all.join()).toContain('발표자 노트 내용');
  });

  it('makes shapes, lines, tables and charts native, not pictures', async () => {
    const { doc, adapter } = await deck();
    const r = await buildPptx(doc, adapter, { mode: 'editable' });
    const { read, names } = await open(r.bytes);
    const b = await read('ppt/slides/slide2.xml');
    expect(b).toContain('prst="roundRect"');
    expect(b).toContain('prst="line"');
    expect(b).toContain('<a:tbl>');
    expect(names.some((n) => /ppt\/charts\/chart\d+\.xml$/.test(n))).toBe(true);
    expect(await read('ppt/slides/slide3.xml')).toContain('graphicFrame');
    expect(r.report.counts.imageFallback).toBe(0);
    expect(r.report.counts.native).toBe(r.report.counts.elements);
  });

  it('gives each pie slice its own colour', async () => {
    const { doc, adapter } = await deck();
    const pie = createChartElement();
    pie.chartType = 'pie';
    const d = applyCommands(doc, [
      { type: 'element.add', slideId: doc.slides[0]!.id, element: pie },
    ]).doc;
    const { read, names } = await open((await buildPptx(d, adapter, { mode: 'editable' })).bytes);
    const charts = await Promise.all(
      names.filter((n) => /ppt\/charts\/chart\d+\.xml$/.test(n)).map(read),
    );
    const xml = charts.find((c) => c.includes('<c:pieChart>'))!;
    const fills = new Set(
      [...xml.matchAll(/<c:dPt>[\s\S]*?srgbClr val="(\w+)"/g)].map((m) => m[1]),
    );
    expect(fills.size).toBe(4);
  });

  it('embeds images as media', async () => {
    const { doc, adapter } = await deck();
    const { names } = await open((await buildPptx(doc, adapter, { mode: 'editable' })).bytes);
    expect(names.some((n) => n.startsWith('ppt/media/'))).toBe(true);
  });

  it('reports a missing image with its slide and id instead of dropping it silently', async () => {
    const { doc } = await deck();
    const r = await buildPptx(doc, { assetUrl: () => undefined }, { mode: 'editable' });
    const item = r.report.items.find((i) => i.code === 'image-missing')!;
    expect(item).toMatchObject({ slide: 1, elementId: 'img', severity: 'error' });
    expect(r.report.counts.lost).toBe(1);
  });

  it('converts WebP through the adapter, or reports failure', async () => {
    const { doc, assetId } = await deck();
    const webp = 'data:image/webp;base64,UklGRg==';
    const failed = await buildPptx(
      doc,
      { assetUrl: (id) => (id === assetId ? webp : undefined) },
      { mode: 'editable' },
    );
    expect(failed.report.items.find((i) => i.code === 'image-format')).toBeDefined();
    const ok = await buildPptx(
      doc,
      { assetUrl: () => webp, toPng: async () => pngUrl },
      { mode: 'editable' },
    );
    expect(ok.report.items.find((i) => i.code === 'image-format')).toBeUndefined();
  });

  it('gradient shapes fall back to an image via the adapter, or report the change', async () => {
    const { doc, adapter } = await deck();
    const shape = createShapeElement('rect');
    shape.fill = {
      type: 'linear',
      angle: 90,
      stops: [
        { offset: 0, color: '#112233' },
        { offset: 1, color: '#ffffff' },
      ],
    };
    const d = applyCommands(doc, [
      { type: 'element.add', slideId: doc.slides[0]!.id, element: shape },
    ]).doc;
    const flat = await buildPptx(d, adapter, { mode: 'editable' });
    expect(flat.report.items.find((i) => i.code === 'gradient-shape')).toMatchObject({
      elementId: shape.id,
    });
    const img = await buildPptx(
      d,
      { ...adapter, rasterizeElement: async () => pngUrl },
      { mode: 'editable' },
    );
    expect(img.report.counts.imageFallback).toBe(1);
  });

  it('keeps hostile text as text', async () => {
    const { doc, adapter } = await deck();
    const el = createTextElement('</a:t><evil/> & "q"');
    const d = applyCommands(doc, [
      { type: 'element.add', slideId: doc.slides[0]!.id, element: el },
    ]).doc;
    const { read } = await open((await buildPptx(d, adapter, { mode: 'editable' })).bytes);
    const xml = await read('ppt/slides/slide1.xml');
    expect(xml).not.toContain('<evil/>');
    expect(xml).toContain('&lt;evil/&gt;');
  });
});

describe('fidelity PPTX', () => {
  it('one full-slide picture per slide, with notes', async () => {
    const { doc, adapter } = await deck();
    const r = await buildPptx(
      doc,
      { ...adapter, rasterizeSlide: async () => pngUrl },
      { mode: 'fidelity' },
    );
    const { read, names } = await open(r.bytes);
    const xml = await read('ppt/slides/slide1.xml');
    expect(xml).toContain('<p:pic>');
    expect(xml).not.toContain('한글과 English');
    expect(r.report.counts.imageFallback).toBe(3);
    expect(names.some((n) => /notesSlide/.test(n))).toBe(true);
  });
  it('requires a capture adapter', async () => {
    const { doc, adapter } = await deck();
    await expect(buildPptx(doc, adapter, { mode: 'fidelity' })).rejects.toThrow('캡처');
  });
  it('reports capture failure', async () => {
    const { doc, adapter } = await deck();
    const r = await buildPptx(
      doc,
      { ...adapter, rasterizeSlide: async () => null },
      { mode: 'fidelity' },
    );
    expect(r.report.items.filter((i) => i.code === 'capture-failed')).toHaveLength(3);
  });
});

describe('report and colours', () => {
  it('formats a human report', async () => {
    const { doc } = await deck();
    const r = await buildPptx(doc, { assetUrl: () => undefined }, { mode: 'editable' });
    const text = formatReport(r.report);
    expect(text).toContain('문서: 3장 /');
    expect(text).toContain('모드: 편집 우선');
    expect(text).toContain('1장: 이미지 데이터가 없어');
    expect(text).toContain('Malgun Gothic');
  });
  it('maps alpha to transparency', () => {
    expect(pptxColor('#00000080')).toEqual({ color: '000000', transparency: 50 });
    expect(pptxColor('#abc')).toEqual({ color: 'AABBCC', transparency: 0 });
    expect(pptxColor('transparent')).toBeNull();
  });
});
