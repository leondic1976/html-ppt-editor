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
  normalizedForCompare,
  SlideElement,
  type DeckDocument,
} from '@hps/document-core';
import {
  buildDeckHtml,
  buildDeckZip,
  DECK_RUNTIME,
  hasDeckMarker,
  parseDeckHtml,
  parseDeckZip,
  type AssetData,
} from '@hps/export-html';
import { contextFor, deckCss, renderSlide } from '@hps/slide-renderer';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const png = async (): Promise<{ id: string; url: string }> => ({
  id: await assetIdFor(Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0)) as BufferSource),
  url: `data:image/png;base64,${PNG}`,
});

async function sampleDeck(): Promise<{ doc: DeckDocument; assets: AssetData; assetId: string }> {
  const { id, url } = await png();
  let doc = createDocument({ title: '샘플 </title><script>alert(1)</script>', slideCount: 2 });
  const [a, b] = doc.slides;
  const img = SlideElement.parse({
    id: 'img-1',
    type: 'image',
    assetId: id,
    frame: { x: 10, y: 20, w: 300, h: 200 },
  });
  const img2 = SlideElement.parse({
    id: 'img-2',
    type: 'image',
    assetId: id,
    frame: { x: 50, y: 20, w: 300, h: 200 },
  });
  doc = applyCommands(doc, [
    {
      type: 'asset.add',
      id,
      meta: { kind: 'image', mime: 'image/png', size: 70, source: 'embedded' },
    },
    {
      type: 'element.add',
      slideId: a!.id,
      element: createTextElement('</script><script>alert("xss")</script> 한글'),
    },
    { type: 'element.add', slideId: a!.id, element: img },
    { type: 'element.add', slideId: b!.id, element: img2 },
    { type: 'element.add', slideId: b!.id, element: createShapeElement('triangle') },
    { type: 'element.add', slideId: b!.id, element: createLineElement() },
    { type: 'element.add', slideId: b!.id, element: createTableElement() },
    { type: 'element.add', slideId: b!.id, element: createChartElement() },
    { type: 'element.add', slideId: b!.id, element: createCodeElement() },
    { type: 'slide.update', slideId: a!.id, patch: { notes: '노트 "따옴표" <b>' } },
  ]).doc;
  return { doc, assets: new Map([[id, url]]), assetId: id };
}

describe('single-file HTML', () => {
  it('round-trips: Native -> HTML -> parse has an identical normalised model', async () => {
    const { doc, assets } = await sampleDeck();
    const first = await buildDeckHtml(doc, assets);
    const parsed = (await parseDeckHtml(first.html))!;
    expect(normalizedForCompare(parsed.doc)).toBe(
      normalizedForCompare({ ...doc, rendererVersion: parsed.doc.rendererVersion }),
    );
    expect(parsed.assets).toEqual(assets);
    expect(parsed.runtimeIntact).toBe(true);
    const second = await buildDeckHtml(parsed.doc, parsed.assets, { now: () => new Date(0) });
    const again = (await parseDeckHtml(second.html))!;
    expect(normalizedForCompare(again.doc)).toBe(normalizedForCompare(parsed.doc));
  });

  it('hostile text cannot break out of the JSON blocks or the page', async () => {
    const { doc, assets } = await sampleDeck();
    const { html } = await buildDeckHtml(doc, assets);
    expect(html).not.toContain('<script>alert');
    expect(html.match(/<script[\s>]/g)).toHaveLength(3);
    expect(html.match(/<\/script>/g)).toHaveLength(3);
  });

  it('stores a shared image once', async () => {
    const { doc, assets } = await sampleDeck();
    const { html } = await buildDeckHtml(doc, assets);
    expect(html.split(PNG)).toHaveLength(2);
    expect(html.match(/data-hps-asset=/g)).toHaveLength(2);
  });

  it('pins the runtime by hash in a no-network CSP', async () => {
    const { doc, assets } = await sampleDeck();
    const { html, selfContained } = await buildDeckHtml(doc, assets);
    const hash = Buffer.from(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(DECK_RUNTIME)),
    ).toString('base64');
    expect(html).toContain(`script-src 'sha256-${hash}'`);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("connect-src 'none'");
    expect(html).not.toContain("'unsafe-inline'; script");
    expect(selfContained).toBe(true);
  });

  it('reports external dependencies and refuses to call them self-contained', async () => {
    const { doc, assetId } = await sampleDeck();
    const ext: DeckDocument = {
      ...doc,
      assets: {
        ...doc.assets,
        [assetId]: {
          kind: 'image',
          mime: 'image/png',
          size: 1,
          source: 'external',
          url: 'https://cdn.example/a.png',
        },
      },
    };
    const r = await buildDeckHtml(ext, new Map());
    expect(r.selfContained).toBe(false);
    expect(r.externalDependencies[0]!.url).toBe('https://cdn.example/a.png');
    expect(r.warnings.join()).toContain('외부 리소스');
    expect(r.html).toContain('img-src data: blob: https:');
  });

  it('reports missing assets', async () => {
    const { doc } = await sampleDeck();
    const r = await buildDeckHtml(doc, new Map());
    expect(r.missingAssets).toHaveLength(1);
    expect(r.selfContained).toBe(false);
  });

  it('presentation mode has no model and inlines images', async () => {
    const { doc, assets } = await sampleDeck();
    const r = await buildDeckHtml(doc, assets, { mode: 'present' });
    expect(r.html).not.toContain('hps-document');
    expect(r.html).toContain(`src="data:image/png;base64,${PNG}"`);
    expect(await parseDeckHtml(r.html)).toBeNull();
    expect(r.warnings.join()).toContain('다시 편집할 수 없습니다');
  });

  it('omits hidden slides from the display but keeps them in the model', async () => {
    const { doc, assets } = await sampleDeck();
    const hidden = applyCommands(doc, [
      { type: 'slide.update', slideId: doc.slides[1]!.id, patch: { hidden: true } },
    ]).doc;
    const { html } = await buildDeckHtml(hidden, assets);
    expect(html.match(/<section /g)).toHaveLength(1);
    expect((await parseDeckHtml(html))!.doc.slides).toHaveLength(2);
  });
});

describe('re-opening hostile files', () => {
  it('flags foreign scripts', async () => {
    const { doc, assets } = await sampleDeck();
    const { html } = await buildDeckHtml(doc, assets);
    const r = (await parseDeckHtml(html.replace('</body>', '<script>evil()</script></body>')))!;
    expect(r.runtimeIntact).toBe(false);
    expect(r.warnings.join()).toContain('앱이 만들지 않은 스크립트');
  });

  it('flags a tampered runtime', async () => {
    const { doc, assets } = await sampleDeck();
    const { html } = await buildDeckHtml(doc, assets);
    const r = (await parseDeckHtml(html.replace("'use strict';", "'use strict';evil();")))!;
    expect(r.runtimeIntact).toBe(false);
  });

  it('rejects an asset whose bytes do not match its id', async () => {
    const { doc, assets, assetId } = await sampleDeck();
    const { html } = await buildDeckHtml(doc, assets);
    const swapped = html.replace(PNG, Buffer.from('other bytes').toString('base64'));
    const r = (await parseDeckHtml(swapped))!;
    expect(r.assets.has(assetId)).toBe(false);
    expect(r.warnings.join()).toContain('변조');
  });

  it('schema-validates the model', async () => {
    const { doc, assets } = await sampleDeck();
    const { html } = await buildDeckHtml(doc, assets);
    const bad = html
      .replace('"formatVersion":2', '"formatVersion":2,"x":1')
      .replace(
        /"type":"solid","color":"#ffffff"/,
        '"type":"solid","color":"red;background:url(x)"',
      );
    await expect(parseDeckHtml(bad)).rejects.toThrow(/문서 검증 실패/);
  });

  it('does not read generic HTML as a deck', async () => {
    expect(hasDeckMarker('<html><body>x</body></html>')).toBe(false);
    expect(await parseDeckHtml('<html><body>x</body></html>')).toBeNull();
  });
});

describe('ZIP', () => {
  it('round-trips and stores assets as files', async () => {
    const { doc, assets, assetId } = await sampleDeck();
    const bytes = await buildDeckZip(doc, assets);
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files).some((n) => n.startsWith('assets/'))).toBe(true);
    const html = await zip.file('index.html')!.async('string');
    expect(html).not.toContain(PNG);
    expect(html).toContain(`assets/${assetId.slice(7, 39)}.png`);
    const parsed = await parseDeckZip(bytes);
    expect(parsed.doc.slides).toHaveLength(2);
    expect(parsed.assets.get(assetId)).toBe(assets.get(assetId));
  });

  it('rejects a ZIP-bomb ratio before inflating', async () => {
    const zip = new JSZip();
    zip.file('deck.json', '{}');
    zip.file('bomb.bin', new Uint8Array(30 * 1024 * 1024));
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    await expect(parseDeckZip(bytes)).rejects.toThrow(/ZIP 폭탄/);
  });

  it('rejects a ZIP without a deck', async () => {
    const zip = new JSZip();
    zip.file('a.txt', 'x');
    await expect(parseDeckZip(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(
      /deck.json/,
    );
  });
});

describe('renderer safety and contract', () => {
  const render = async () => {
    const { doc, assets } = await sampleDeck();
    return { doc, ctx: contextFor(doc, { mode: 'src', url: (id) => assets.get(id) }) };
  };

  it('escapes text and never emits script or handlers', async () => {
    const { doc, ctx } = await render();
    const html = doc.slides.map((s) => renderSlide(s, ctx)).join('');
    expect(html).not.toMatch(/<script|\son\w+=/i);
    expect(html).toContain('&lt;/script&gt;');
  });

  it('refuses unsafe link schemes', async () => {
    const { doc, ctx } = await render();
    const el = createTextElement('x');
    el.content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'click',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
      ],
    };
    const slide = { ...doc.slides[0]!, elements: [el] };
    expect(renderSlide(slide, ctx)).not.toContain('javascript:');
    el.content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'click',
              marks: [{ type: 'link', attrs: { href: 'https://a.b' } }],
            },
          ],
        },
      ],
    };
    expect(renderSlide(slide, ctx)).toContain('rel="noopener noreferrer"');
  });

  it('keeps model coordinates in output, independent of zoom', async () => {
    const { doc, ctx } = await render();
    const html = renderSlide(doc.slides[0]!, ctx);
    expect(html).toContain('left:10px;top:20px;width:300px;height:200px');
    expect(html).toContain('width:1920px;height:1080px');
  });

  it('draws in zIndex order', async () => {
    const { doc, ctx } = await render();
    const a = createShapeElement('rect');
    const b = createShapeElement('ellipse');
    const html = renderSlide(
      {
        ...doc.slides[0]!,
        elements: [
          { ...a, zIndex: 5 },
          { ...b, zIndex: 1 },
        ],
      },
      ctx,
    );
    expect(html.indexOf(b.id)).toBeLessThan(html.indexOf(a.id));
  });

  it('declares page size for print', () => {
    expect(deckCss({ width: 1920, height: 1080 })).toContain('@page{size:1920px 1080px;margin:0}');
  });
});
