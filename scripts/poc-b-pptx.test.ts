/**
 * PoC B generator: writes a Korean/English golden deck as PPTX for checking in real PowerPoint
 * (scripts/verify-powerpoint.ps1). Run with: pnpm vitest run --config scripts/vitest.scripts.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
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
import { buildDeckHtml } from '@hps/export-html';
import { buildPptx } from '@hps/export-pptx';
import { formatReport } from '@hps/export-report';
import { deflateSync } from 'node:zlib';

/** A real gradient PNG, so visual checks can see image placement. */
function makePng(w: number, h: number): Uint8Array {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = Math.round((x / w) * 255);
      raw[row + 2 + x * 3] = Math.round((y / h) * 255);
      raw[row + 3 + x * 3] = 160;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer): number => {
    let c = 0xffffffff;
    for (const v of b) c = crcTable[(c ^ v) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#2563eb"/><path d="M28 52l15 15 30-34" fill="none" stroke="#fff" stroke-width="9"/></svg>`;

it('writes the PoC B deck', async () => {
  const png = makePng(320, 180);
  const pngId = await assetIdFor(png as BufferSource);
  const pngUrl = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
  const svgBytes = new TextEncoder().encode(SVG);
  const svgId = await assetIdFor(svgBytes as BufferSource);
  const svgUrl = `data:image/svg+xml;base64,${Buffer.from(svgBytes).toString('base64')}`;

  let doc = createDocument({ title: 'PoC B 한글 English', slideCount: 3 });
  const [a, b, c] = doc.slides;

  const title = createTextElement('한글과 English 혼합 제목 2026', {
    x: 120,
    y: 80,
    w: 1680,
    h: 170,
  });
  title.style.fontSizePx = 100;
  title.style.fontWeight = 700;
  title.style.fontFamily = 'Malgun Gothic';
  const body = createTextElement('', { x: 120, y: 290, w: 900, h: 500 });
  body.style.fontFamily = 'Malgun Gothic';
  body.style.fontSizePx = 44;
  body.style.letterSpacingPx = 2;
  body.content = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '일반 ' },
          { type: 'text', text: '굵게', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: '기울임', marks: [{ type: 'italic' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: '밑줄', marks: [{ type: 'underline' }] },
          { type: 'text', text: ' ' },
          {
            type: 'text',
            text: '빨강',
            marks: [{ type: 'textStyle', attrs: { color: '#dc2626' } }],
          },
        ],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: '첫째 항목: 줄바꿈이 어떻게 되는지 보기 위한 꽤 긴 문장입니다.',
                  },
                ],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Second item with English' }] },
            ],
          },
        ],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: '링크',
            marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
          },
        ],
      },
    ],
  };
  const photo = SlideElement.parse({
    id: 'photo',
    type: 'image',
    assetId: pngId,
    frame: { x: 1080, y: 290, w: 720, h: 405 },
    naturalWidth: 320,
    naturalHeight: 180,
  });
  const cover = SlideElement.parse({
    id: 'cover',
    type: 'image',
    assetId: pngId,
    frame: { x: 1080, y: 720, w: 300, h: 300 },
    naturalWidth: 320,
    naturalHeight: 180,
    fit: 'cover',
  });
  const logo = SlideElement.parse({
    id: 'logo',
    type: 'svg',
    assetId: svgId,
    frame: { x: 1500, y: 730, w: 240, h: 240 },
  });

  const round = createShapeElement('roundRect', { x: 80, y: 80, w: 500, h: 300 });
  const tri = createShapeElement('triangle', { x: 640, y: 80, w: 300, h: 300 });
  tri.fill = { type: 'solid', color: '#16a34a' };
  const ell = createShapeElement('ellipse', { x: 1000, y: 80, w: 400, h: 300 });
  ell.fill = { type: 'solid', color: '#f59e0b80' };
  ell.stroke = { color: '#0f172a', width: 8, dash: 'dashed' };
  const shadow = createShapeElement('rect', { x: 1460, y: 80, w: 380, h: 300 });
  shadow.fill = { type: 'solid', color: '#ffffff' };
  shadow.shadow = { x: 12, y: 12, blur: 30, color: '#00000066' };
  const line = createLineElement({ x: 80, y: 430, w: 800, h: 4 });
  line.endArrow = true;
  const rotated = createTextElement('회전 15°', { x: 960, y: 420, w: 600, h: 120, rotate: 15 });
  rotated.style.fontFamily = 'Malgun Gothic';
  const table = createTableElement({ x: 80, y: 600, w: 1100, h: 400 });

  const chart = createChartElement({ x: 80, y: 60, w: 880, h: 560 });
  const pie = createChartElement({ x: 1000, y: 60, w: 840, h: 560 });
  pie.chartType = 'pie';
  pie.title = '비율';
  const code = createCodeElement({ x: 80, y: 660, w: 1760, h: 360 });
  code.tokens = [
    [{ text: 'function', color: '#c084fc' }, { text: ' hello() {' }],
    [{ text: "  console.log('" }, { text: '안녕하세요', color: '#86efac' }, { text: "');" }],
    [{ text: '}' }],
  ];

  doc = applyCommands(doc, [
    {
      type: 'asset.add',
      id: pngId,
      meta: { kind: 'image', mime: 'image/png', size: png.length, source: 'embedded' },
    },
    {
      type: 'asset.add',
      id: svgId,
      meta: { kind: 'svg', mime: 'image/svg+xml', size: svgBytes.length, source: 'embedded' },
    },
    ...[title, body, photo, cover, logo].map((element) => ({
      type: 'element.add' as const,
      slideId: a!.id,
      element,
    })),
    { type: 'slide.update', slideId: a!.id, patch: { notes: '발표자 노트: 한글 메모 입니다.' } },
    {
      type: 'slide.update',
      slideId: b!.id,
      patch: { background: { type: 'solid', color: '#eef2ff' } },
    },
    ...[round, tri, ell, shadow, line, rotated, table].map((element) => ({
      type: 'element.add' as const,
      slideId: b!.id,
      element,
    })),
    ...[chart, pie, code].map((element) => ({
      type: 'element.add' as const,
      slideId: c!.id,
      element,
    })),
  ]).doc;

  const urls = new Map([
    [pngId, pngUrl],
    [svgId, svgUrl],
  ]);
  const { bytes, report } = await buildPptx(
    doc,
    { assetUrl: (id) => urls.get(id) },
    { mode: 'editable' },
  );
  mkdirSync('artifacts/poc-b', { recursive: true });
  writeFileSync('artifacts/poc-b/poc-b.pptx', bytes);
  writeFileSync('artifacts/poc-b/report.txt', formatReport(report));
  console.log(formatReport(report));

  // The same deck is the golden fixture: a saved file the round-trip and visual tests reopen.
  const fixed: DeckDocument = {
    ...doc,
    docId: 'doc-golden',
    slides: doc.slides.map((s, i) => ({
      ...s,
      id: `slide-${i}`,
      elements: s.elements.map((e, j) => ({ ...e, id: `el-${i}-${j}` })),
    })),
  };
  const html = await buildDeckHtml(fixed, urls, {
    now: () => new Date('2026-11-02T00:00:00Z'),
    appVersion: '0.1.0',
  });
  mkdirSync('fixtures/native-decks', { recursive: true });
  writeFileSync('fixtures/native-decks/golden.html', html.bytes);
});
