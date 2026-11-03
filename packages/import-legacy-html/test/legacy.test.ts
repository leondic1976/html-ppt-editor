// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  addToJournal,
  applyJournal,
  buildPreview,
  buildSavedHtml,
  detectSlides,
  editStyle,
  editText,
  indexDocument,
  jsonForScriptTag,
  makeKey,
  mergeStyle,
  openLegacy,
  parseGradient,
  cssColorToHex,
  previewFor,
  purifyPreview,
  replaceImage,
  sanitizeInlineHtml,
} from '@hps/import-legacy-html';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const open = (html: string | Uint8Array, name = 'deck.html') =>
  openLegacy(typeof html === 'string' ? enc(html) : html, { fileName: name });

/* Deliberately odd formatting: single quotes, uppercase, odd spacing, comments, CRLF. */
const DECK = [
  '<!DOCTYPE html>\r\n<HTML lang="ko">\r\n<head>\r\n  <meta charset="utf-8">',
  '  <title>원본 제목</title>\r\n  <STYLE>.slide{ width:1920px;height:1080px }  /* keep me */</STYLE>',
  '</head>\r\n<body>\r\n<!-- author note -->',
  '<section class=\'slide\' id=s1>\r\n   <h1   class="t">첫 번째   제목</h1>\r\n   <p>본문 <b>굵게</b> 끝</p>',
  '   <img src="a.png" alt="사진" srcset="a2.png 2x" style="border:1px solid red">\r\n</section>',
  '<section class="slide" id=s2><h2 data-deck-edit-id="t2">둘째 &amp; 제목</h2><div style="background:url(bg.png)">x</div></section>',
  '<script>document.title="x"</script>\r\n</body>\r\n</HTML>\r\n',
].join('\r\n');

const idOf = (s: Awaited<ReturnType<typeof open>>, text: string): string => {
  for (const [id, t] of s.index.texts) if (t.text.includes(text)) return id;
  throw new Error(`no text ${text}`);
};
const imgOf = (s: Awaited<ReturnType<typeof open>>, src: string): string => {
  for (const [id, t] of s.index.images) if (t.src === src) return id;
  throw new Error(`no image ${src}`);
};

describe('byte preservation', () => {
  it('reproduces the exact original bytes when nothing was edited', async () => {
    const s = await open(DECK);
    const out = await buildSavedHtml(s);
    expect(out.text).toBe(DECK);
    expect(Buffer.from(out.bytes).equals(Buffer.from(enc(DECK)))).toBe(true);
  });

  it('changes only the edited range, keeping CRLF, comments, case and quoting', async () => {
    const s = await open(DECK);
    const journal = editText(s, [], idOf(s, '첫 번째'), { text: '바뀐 제목' });
    const out = await buildSavedHtml(s, { journal, keepHistory: false });
    expect(out.text).toBe(DECK.replace('첫 번째   제목', '바뀐 제목'));
    expect(out.text).toContain('<!-- author note -->');
    expect(out.text).toContain('/* keep me */');
    expect(out.text).toContain("<section class='slide' id=s1>\r\n");
    expect(out.text).toContain('<script>document.title="x"</script>');
  });

  it('keeps a UTF-8 BOM', async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...enc(DECK)]);
    const s = await open(bytes);
    const out = await buildSavedHtml(s);
    expect([...out.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(Buffer.from(out.bytes).equals(Buffer.from(bytes))).toBe(true);
  });

  it('opens EUC-KR, and saves as UTF-8 with a corrected charset', async () => {
    const korean = new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb]); // 한글
    const bytes = new Uint8Array([
      ...enc('<html><head><meta charset="euc-kr"></head><body><section class="slide"><h1>'),
      ...korean,
      ...enc('</h1></section></body></html>'),
    ]);
    const s = await open(bytes);
    expect(s.encoding).toBe('euc-kr');
    const id = idOf(s, '한글');
    const out = await buildSavedHtml(s, {
      journal: editText(s, [], id, { text: '수정' }),
      keepHistory: false,
    });
    expect(out.text).toContain('charset="utf-8"');
    expect(out.text).toContain('<h1>수정</h1>');
    expect(s.report.warnings.map((w) => w.code)).toContain('encoding');
  });
});

describe('text edits', () => {
  it('escapes user input so it cannot become markup', async () => {
    const s = await open(DECK);
    const journal = editText(s, [], idOf(s, '첫 번째'), { text: '<script>alert(1)</script> & 끝' });
    const { text } = await buildSavedHtml(s, { journal, keepHistory: false });
    expect(text).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; 끝');
    expect(text).not.toContain('<script>alert(1)');
  });

  it('keeps inline structure through inner-html edits and strips active content', async () => {
    const s = await open(DECK);
    const id = idOf(s, '본문');
    const journal = editText(s, [], id, {
      html: '새 <b class="x" onclick="evil()">굵게</b><script>evil()</script>',
    });
    const { text } = await buildSavedHtml(s, { journal, keepHistory: false });
    expect(text).toContain('<p>새 <b class="x">굵게</b>evil()</p>');
    expect(text).not.toContain('onclick');
  });

  it('later edits to the same block replace earlier ones', async () => {
    const s = await open(DECK);
    const id = idOf(s, '첫 번째');
    let journal = editText(s, [], id, { text: 'A' });
    journal = editText(s, journal, id, { text: 'B' });
    expect(journal).toHaveLength(1);
    expect((await buildSavedHtml(s, { journal, keepHistory: false })).text).toContain('>B</h1>');
  });

  it('resolves through data-deck-edit-id', async () => {
    const s = await open(DECK);
    const id = idOf(s, '둘째');
    const journal = editText(s, [], id, { text: '수정' });
    expect(journal[0]!.key.editId).toBe('t2');
  });

  it('does not offer script, style or title content for editing', async () => {
    const s = await open(DECK);
    const texts = [...s.index.texts.values()].map((t) => t.text);
    expect(texts.some((t) => t.includes('document.title'))).toBe(false);
    expect(texts.some((t) => t.includes('keep me'))).toBe(false);
    expect(texts.some((t) => t.includes('원본 제목'))).toBe(false);
  });

  it('never nests an editable block inside another', async () => {
    const s = await open('<section class="slide"><div>겉 <span>속</span></div></section>');
    expect(s.index.texts.size).toBe(1);
  });
});

describe('image replacement', () => {
  const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';

  it('swaps src, drops srcset and pins the old box, merging existing style', async () => {
    const s = await open(DECK);
    const journal = replaceImage(s, [], imgOf(s, 'a.png'), {
      dataUrl,
      box: { width: 400, height: 300 },
    });
    const { text } = await buildSavedHtml(s, { journal, keepHistory: false });
    expect(text).toContain(`src="${dataUrl}"`);
    expect(text).not.toContain('srcset');
    expect(text).toMatch(
      /style="border: 1px solid red; width: 400px; height: 300px; object-fit: cover; object-position: 50% 50%"/,
    );
    expect(text).toContain('alt="사진"');
  });

  it('replaces inline background urls', async () => {
    const s = await open(DECK);
    const journal = replaceImage(s, [], imgOf(s, 'bg.png'), { dataUrl });
    const { text } = await buildSavedHtml(s, { journal, keepHistory: false });
    expect(text).toContain(`background:url(&quot;${dataUrl}&quot;)`);
  });

  it('applies text and image edits together', async () => {
    const s = await open(DECK);
    let j = editText(s, [], idOf(s, '첫 번째'), { text: '새 제목' });
    j = replaceImage(s, j, imgOf(s, 'a.png'), { dataUrl });
    const out = await buildSavedHtml(s, { journal: j, keepHistory: false });
    expect(out.conflicts).toEqual([]);
    expect(out.text).toContain('새 제목');
    expect(out.text).toContain(dataUrl);
  });
});

describe('style edits', () => {
  it('merges declarations', () => {
    expect(mergeStyle('color: red; margin:0', { color: 'blue', 'font-size': '10px' })).toBe(
      'color: blue; margin: 0; font-size: 10px',
    );
    expect(mergeStyle('color: red', { color: null })).toBe('');
  });
  it('keeps prior style edits on the same element', async () => {
    const s = await open(DECK);
    const id = idOf(s, '첫 번째');
    let j = editStyle(s, [], id, { color: '#ff0000' });
    j = editStyle(s, j, id, { 'font-size': '60px' });
    const { text } = await buildSavedHtml(s, { journal: j, keepHistory: false });
    expect(text).toContain('style="color: #ff0000; font-size: 60px"');
  });
  it('adds a style attribute where none exists, with no other change', async () => {
    const src = '<section class="slide"><h1 class="t">x</h1></section>';
    const s = await open(src);
    const j = editStyle(s, [], idOf(s, 'x'), { color: '#000' });
    const { text } = await buildSavedHtml(s, { journal: j, keepHistory: false });
    expect(text).toBe('<section class="slide"><h1 style="color: #000" class="t">x</h1></section>');
  });
});

describe('save and reopen', () => {
  it('re-opening restores the journal without applying edits twice', async () => {
    const s = await open(DECK);
    const journal = editText(s, [], idOf(s, '첫 번째'), { text: '새 제목' });
    const first = await buildSavedHtml(s, { journal });

    const again = await open(first.bytes);
    expect(again.restoredFromSidecar).toBe(true);
    expect(again.source).toBe(DECK);
    expect(again.journal).toHaveLength(1);

    const second = await buildSavedHtml(again);
    expect(second.text).toBe(first.text);
    // The journal in the sidecar also holds this text, so count rendered occurrences only.
    expect(second.text.match(/>새 제목</g)).toHaveLength(1);
  });

  it('survives two more edit-save-reopen cycles', async () => {
    let s = await open(DECK);
    let bytes = (
      await buildSavedHtml(s, { journal: editText(s, [], idOf(s, '첫 번째'), { text: 'v1' }) })
    ).bytes;
    s = await open(bytes);
    bytes = (
      await buildSavedHtml(s, { journal: editText(s, s.journal, idOf(s, '둘째'), { text: 'v2' }) })
    ).bytes;
    s = await open(bytes);
    bytes = (
      await buildSavedHtml(s, {
        journal: editText(s, s.journal, idOf(s, '첫 번째'), { text: 'v3' }),
      })
    ).bytes;
    s = await open(bytes);
    const text = dec(bytes);
    expect(text).toContain('>v3</h1>');
    expect(text).toContain('>v2</h2>');
    expect(text).not.toContain('>v1<');
    expect(s.source).toBe(DECK);
  });

  it('treats a file edited outside the app as a new original', async () => {
    const s = await open(DECK);
    const saved = await buildSavedHtml(s, {
      journal: editText(s, [], idOf(s, '첫 번째'), { text: '앱 수정' }),
    });
    const tampered = saved.text.replace('둘째', '외부 수정');
    const again = await open(tampered);
    expect(again.restoredFromSidecar).toBe(false);
    expect(again.journal).toEqual([]);
    expect(again.source).toContain('외부 수정');
    expect(again.source).toContain('앱 수정');
    expect(again.report.warnings.map((w) => w.code)).toContain('edited-outside');
    expect(again.source).not.toContain('hps-legacy-state');
  });

  it('a malformed sidecar cannot break opening', async () => {
    const bad = DECK.replace(
      '</head>',
      '<script type="application/json" id="hps-legacy-state">{oops</script></head>',
    );
    const s = await open(bad);
    expect(s.restoredFromSidecar).toBe(false);
    expect(s.report.warnings.map((w) => w.code)).toContain('sidecar-invalid');
  });

  it('sidecar JSON cannot close its script tag', async () => {
    const out = jsonForScriptTag({ a: '</script><script>alert(1)</script>', b: '<!--' });
    expect(out).not.toMatch(/<|>/);
    expect(JSON.parse(out).a).toBe('</script><script>alert(1)</script>');
    const s = await open(DECK);
    const j = editText(s, [], idOf(s, '첫 번째'), { text: '</script><script>alert(1)</script>' });
    const saved = await buildSavedHtml(s, { journal: j });
    const reopened = await open(saved.bytes);
    expect(reopened.restoredFromSidecar).toBe(true);
    expect(saved.text).not.toContain('<script>alert(1)');
  });
});

describe('conflicts are never guessed', () => {
  it('refuses a patch whose anchor no longer matches', () => {
    const src = '<p>원문</p>';
    const index = indexDocument(src);
    const path = [...index.texts.keys()][0]!;
    const op = { kind: 'text', text: 'x' } as const;
    const key = makeKey(index, path, op);
    const entry = { key: { ...key, anchor: 'stale' }, op, at: '' };
    const r = applyJournal(index, [entry]);
    expect(r.output).toBe(src);
    expect(r.conflicts[0]!.reason).toBe('anchor-mismatch');
  });

  it('refuses a patch whose target is missing', () => {
    const src = '<p>원문</p>';
    const index = indexDocument(src);
    const r = applyJournal(index, [
      { key: { path: '9/9', anchor: '' }, op: { kind: 'text', text: 'x' }, at: '' },
    ]);
    expect(r.output).toBe(src);
    expect(r.conflicts[0]!.reason).toBe('target-missing');
  });

  it('an inner edit absorbs edits inside it', () => {
    const j = addToJournal(
      [
        {
          key: { path: '1/1/0/0', anchor: 'a' },
          op: { kind: 'attr', name: 'x', value: '1' },
          at: '',
        },
      ],
      { key: { path: '1/1/0', anchor: 'b' }, op: { kind: 'text', text: 't' }, at: '' },
    );
    expect(j).toHaveLength(1);
  });
});

describe('large embedded data', () => {
  const big = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(10000);
  const src = `<!doctype html><html><head><title>x</title></head><body><section class="slide"><h1>제목</h1><img src="${big}" alt="a"></section><section class="slide">b</section></body></html>`;

  it('keeps bytes exact around tokenised blobs, through edit, save and reopen', async () => {
    const s = await open(src);
    expect(s.index.work.length).toBeLessThan(src.length / 10);
    expect((await buildSavedHtml(s)).text).toBe(src);
    const journal = editText(s, [], idOf(s, '제목'), { text: '새 제목' });
    const saved = await buildSavedHtml(s, { journal });
    expect(saved.text).toContain(big);
    expect(saved.text).not.toContain('HPSBLOB');
    const again = await open(saved.bytes);
    expect(again.restoredFromSidecar).toBe(true);
    expect(again.source).toBe(src);
    expect((await buildSavedHtml(again)).text).toBe(saved.text);
  });

  it('shows the real picture in the preview', async () => {
    const s = await open(src);
    const html = previewFor(s, []);
    expect(html).toContain(big);
    expect(html).not.toContain('HPSBLOB');
  });

  it('replaces a large embedded image', async () => {
    const s = await open(src);
    const id = [...s.index.images.keys()][0]!;
    const journal = replaceImage(s, [], id, { dataUrl: 'data:image/png;base64,AAAA' });
    const { text, conflicts } = await buildSavedHtml(s, { journal, keepHistory: false });
    expect(conflicts).toEqual([]);
    expect(text).not.toContain(big);
    expect(text).toContain('src="data:image/png;base64,AAAA"');
  });
});

describe('slide detection', () => {
  const detect = (html: string) => detectSlides(indexDocument(html));

  it('finds section.slide', () => {
    expect(detect(DECK)).toMatchObject({ status: 'detected', rule: 'section.slide' });
    expect(detect(DECK).slides).toHaveLength(2);
  });
  it('finds data attributes and reveal structure', () => {
    expect(detect('<div data-slide="1">a</div><div data-slide="2">b</div>').rule).toBe(
      '[data-slide]',
    );
    expect(
      detect(
        '<div class="reveal"><div class="slides"><section>a</section><section>b</section></div></div>',
      ).rule,
    ).toBe('.reveal .slides > section');
  });
  it('finds bare body sections and repeated frames at lower confidence', () => {
    expect(detect('<body><section>a</section><section>b</section></body>').rule).toBe(
      'body > section',
    );
    const r = detect(
      '<div class="deck"><div class="frame">a</div><div class="frame">b</div><div class="frame">c</div></div>',
    );
    expect(r.slides).toHaveLength(3);
    expect(r.confidence).toBeLessThan(0.8);
    expect(r.notes.length).toBeGreaterThan(0);
  });
  it('ignores nested matches and lookalike classes', () => {
    const r = detect(
      '<div class="slide"><div class="slide">in</div></div><div class="slide">b</div><div class="slide-title">t</div>',
    );
    expect(r.slides).toHaveLength(2);
  });
  it('does not invent pages for a plain web page', () => {
    const r = detect('<body><header>h</header><main><p>article</p></main></body>');
    expect(r.status).toBe('failed');
    expect(r.slides).toEqual([]);
    expect(r.notes[0]).toContain('슬라이드 구분을 찾지 못했습니다');
  });
  it('reports script-rendered decks with an explanation', () => {
    const r = detect(
      `<body><div id="app"></div><script>const slides=[{t:'a'}];${'x;'.repeat(200)}app.innerHTML=render(slides)</script></body>`,
    );
    expect(r.scriptRendered).toBe(true);
    expect(r.notes.join()).toContain('스크립트');
  });
});

describe('preview isolation', () => {
  const nasty = `<!doctype html><html><head>
    <base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example">
    <link rel="stylesheet" href="https://evil.example/x.css"><link rel="prefetch" href="https://evil.example/p">
    <script src="https://evil.example/x.js"></script>
    <style>body{background:url(https://evil.example/track.png)}</style></head>
    <body onload="evil()"><section class="slide">
      <img src="https://evil.example/pixel.gif" onerror="evil()">
      <a href="java&#10;script:evil()">x</a><a href="https://ok.example">y</a>
      <iframe srcdoc="<script>evil()</script>"></iframe><object data="x"></object><embed src="y">
      <svg><script>evil()</script><a xlink:href="javascript:evil()"><text>t</text></a><animate attributeName="href" to="javascript:evil()"/></svg>
      <form action="https://evil.example"><input formaction="https://evil.example"><button>b</button></form>
      <div data-hps-id="spoof" data-hps-current onclick="evil()">z</div>
    </section><script>evil()</script></body></html>`;

  const result = buildPreview(nasty);

  it('removes active content from the preview copy', () => {
    const h = result.html;
    expect(h).not.toMatch(/<script/i);
    expect(h).not.toMatch(/\sonload|\sonerror|\sonclick/i);
    expect(h).not.toMatch(/javascript:/i);
    expect(h).not.toMatch(/<iframe|<object|<embed|<base|http-equiv="refresh"/i);
    expect(h).not.toContain('formaction');
    expect(h).not.toContain('evil.example/x.css');
    // Kept only as an inert attribute so the UI can name what was blocked.
    expect(h).not.toMatch(/\ssrc="https:\/\/evil/);
    expect(h).not.toContain('animate');
    expect(result.removed.scripts).toBeGreaterThanOrEqual(3);
  });

  it('puts a blocking CSP before all author content', () => {
    const csp = result.html.indexOf('Content-Security-Policy');
    const author = result.html.indexOf('class="slide"');
    expect(csp).toBeGreaterThan(0);
    expect(csp).toBeLessThan(author);
    expect(result.html).toContain("default-src 'none'");
    expect(result.html).not.toMatch(/script-src/);
  });

  it('allows external images only on explicit opt-in, and never scripts', () => {
    const opened = buildPreview(nasty, { allowExternal: true });
    expect(opened.html).toContain('https://evil.example/pixel.gif');
    expect(opened.html).toContain('img-src data: blob: https:');
    expect(opened.html).not.toMatch(/<script/i);
  });

  it('a file cannot spoof editor attributes', () => {
    expect(result.html).not.toContain('data-hps-id="spoof"');
    // The attribute names also appear in the preview stylesheet, so check the element itself.
    expect(result.html).toMatch(/<div data-hps-id="[\d/]+">z<\/div>/);
  });

  it('removes external CSS beacons in every form, unless the user opted in', () => {
    const src = `<style>@import "https://evil.example/a.css"; @import url(https://evil.example/b.css); .x{background:url('https://evil.example/c.png')} .y{background:url(//evil.example/d.png)}</style><div style="background:url(https://evil.example/e.png)">z</div>`;
    const strict = buildPreview(src);
    expect(strict.html).not.toContain('evil.example');
    expect(strict.externalResources).toEqual(
      expect.arrayContaining([
        'https://evil.example/a.css',
        'https://evil.example/b.css',
        'https://evil.example/c.png',
        '//evil.example/d.png',
        'https://evil.example/e.png',
      ]),
    );
    expect(buildPreview(src, { allowExternal: true }).html).toContain('https://evil.example/c.png');
  });

  it('removes SVG href animation despite camelCase attribute names', () => {
    const p = buildPreview(
      '<svg><a><animate attributeName="href" to="javascript:evil()"/></a><set attributeName="xlink:href" to="javascript:evil()"/></svg>',
    );
    expect(p.html).not.toMatch(/javascript:|<animate|<set/i);
  });

  it('does not add a doctype the file does not have', () => {
    expect(buildPreview('<p>x</p>').html).not.toMatch(/doctype/i);
    expect(buildPreview('<!doctype html><p>x</p>').html.match(/doctype/gi)).toHaveLength(1);
  });

  it('reports what it blocked', () => {
    expect(result.externalResources.join()).toContain('evil.example');
  });

  it('assigns the same ids as the index, including after dropped siblings', async () => {
    const src =
      '<body><script>x</script><iframe></iframe><section class="slide"><h1>제목</h1></section></body>';
    const idx = indexDocument(src);
    const id = [...idx.texts.keys()][0]!;
    expect(buildPreview(src).html).toContain(`data-hps-id="${id}"`);
  });

  it('DOMPurify as an independent layer keeps ids and layout while removing script', () => {
    const { window } = new JSDOM('');
    const clean = purifyPreview(
      `<!doctype html><html><head><style>.a{color:red}</style></head><body><div data-hps-id="1/0" class="a">x<script>evil()</script><img src=x onerror=evil()></div></body></html>`,
      window as unknown as Window & typeof globalThis,
    );
    expect(clean).toContain('data-hps-id="1/0"');
    expect(clean).toContain('.a{color:red}');
    expect(clean).not.toMatch(/<script|onerror/);
  });

  it('applies journal edits in the preview', async () => {
    const s = await open(DECK);
    const j = editText(s, [], idOf(s, '첫 번째'), { text: '새 글' });
    expect(previewFor(s, j)).toContain('새 글');
  });

  it('marks missing relative images', async () => {
    const s = await open(DECK);
    expect(s.report.missingLocalAssets).toContain('a.png');
    expect(s.report.warnings.map((w) => w.code)).toContain('missing-assets');
  });

  it('links supplied local files by name', () => {
    const p = buildPreview('<img src="./img/a.png">', {
      localAssets: new Map([['a.png', 'data:image/png;base64,AA==']]),
    });
    expect(p.html).toContain('data:image/png;base64,AA==');
    expect(p.missingLocalAssets).toEqual([]);
  });
});

describe('inline sanitiser', () => {
  it('allows formatting and removes the rest', () => {
    expect(sanitizeInlineHtml('<b>x</b><i onclick="y">z</i><img src=x onerror=y>')).toBe(
      '<b>x</b><i>z</i>',
    );
    expect(sanitizeInlineHtml('<a href="javascript:y">x</a>')).toBe('<a>x</a>');
    expect(sanitizeInlineHtml('<a href="https://a.b">x</a>')).toBe('<a href="https://a.b">x</a>');
    expect(sanitizeInlineHtml('<span style="background:url(http://x)">s</span>')).toBe(
      '<span>s</span>',
    );
    expect(sanitizeInlineHtml('<div>a</div><div>b</div>')).toBe('a<br>b');
  });
});

describe('report', () => {
  it('summarises the import', async () => {
    const s = await open(DECK);
    expect(s.report).toMatchObject({ slideCount: 2, trust: 'scripted', encoding: 'utf-8' });
    expect(s.report.editableTexts).toBeGreaterThanOrEqual(3);
    expect(s.report.removed.scripts).toBe(1);
  });
  it('marks a flagged file', async () => {
    const s = await open(
      '<section class="slide">a</section><script>new ActiveXObject("x")</script>',
    );
    expect(s.report.trust).toBe('flagged');
  });
});

describe('computed style parsers', () => {
  it('converts colours', () => {
    expect(cssColorToHex('rgb(255, 0, 16)')).toBe('#ff0010');
    expect(cssColorToHex('rgba(0, 0, 0, 0)')).toBe('transparent');
    expect(cssColorToHex('rgba(0, 0, 0, 0.5)')).toBe('#00000080');
    expect(cssColorToHex('oklch(1 0 0)')).toBeNull();
  });
  it('parses gradients and rejects what it cannot map', () => {
    expect(
      parseGradient('linear-gradient(135deg, rgb(0, 0, 0) 0%, rgb(255, 255, 255) 100%)'),
    ).toEqual({
      type: 'linear',
      angle: 135,
      stops: [
        { offset: 0, color: '#000000' },
        { offset: 1, color: '#ffffff' },
      ],
    });
    expect(parseGradient('radial-gradient(circle, rgb(1, 1, 1), rgb(2, 2, 2))')?.type).toBe(
      'radial',
    );
    expect(parseGradient('url("x.png")')).toBeNull();
    expect(parseGradient('conic-gradient(red, blue)')).toBeNull();
  });
});
