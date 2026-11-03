import { describe, expect, it } from 'vitest';
import {
  applyCommands,
  canonicalJson,
  createDocument,
  createShapeElement,
  createTextElement,
  createUnitConverter,
  DocumentValidationError,
  emptyHistory,
  normalizedForCompare,
  parseDocument,
  plainTextFromDoc,
  docFromPlainText,
  pushHistory,
  redo,
  undo,
} from '@hps/document-core';

describe('UnitConverter (plan §6 contract)', () => {
  const u = createUnitConverter({ width: 1920, height: 1080 });
  it('maps 1920×1080 to 13⅓×7.5in, 144 model-px per inch', () => {
    expect(u.widthIn).toBeCloseTo(13.3333, 3);
    expect(u.heightIn).toBeCloseTo(7.5, 6);
    expect(u.inches(144)).toBeCloseTo(1, 9);
    expect(u.inches(1920)).toBeCloseTo(40 / 3, 9);
  });
  it('fontSizePx=100 becomes 50pt', () => {
    expect(u.points(100)).toBeCloseTo(50, 9);
  });
  it('produces whole EMU', () => {
    expect(u.emu(144)).toBe(914400);
  });
  it('round-trips inches', () => {
    expect(u.fromInches(u.inches(733))).toBeCloseTo(733, 9);
  });
  it('normalises other page widths to the same physical slide', () => {
    const small = createUnitConverter({ width: 1280, height: 720 });
    expect(small.widthIn).toBeCloseTo(u.widthIn, 9);
    expect(small.heightIn).toBeCloseTo(7.5, 6);
    expect(small.points(100)).toBeCloseTo(75, 9);
  });
  it('rejects a zero page', () => {
    expect(() => createUnitConverter({ width: 0, height: 10 })).toThrow(RangeError);
  });
});

describe('schema and migration', () => {
  it('accepts a created document', () => {
    const doc = createDocument({ slideCount: 2 });
    expect(parseDocument(JSON.parse(JSON.stringify(doc))).slides).toHaveLength(2);
  });
  it('reports field paths on invalid input', () => {
    const doc = createDocument();
    const bad = JSON.parse(JSON.stringify(doc));
    bad.slides[0].background = { type: 'solid', color: 'url(https://evil/x)' };
    try {
      parseDocument(bad);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DocumentValidationError);
      const issue = (e as DocumentValidationError).issues[0]!;
      expect(issue.path).toBe('slides.0.background.color');
    }
  });
  it('refuses CSS injection through font names', () => {
    const doc = JSON.parse(JSON.stringify(createDocument()));
    doc.theme.fontFamily = 'x";}body{background:url(//evil)}';
    expect(() => parseDocument(doc)).toThrow(DocumentValidationError);
  });
  it('refuses unknown element types', () => {
    const doc = JSON.parse(JSON.stringify(createDocument()));
    doc.slides[0].elements.push({
      id: 'x',
      type: 'html',
      frame: { x: 0, y: 0, w: 1, h: 1 },
      html: '<script>',
    });
    expect(() => parseDocument(doc)).toThrow(DocumentValidationError);
  });
  it('rejects newer versions with a clear message', () => {
    expect(() => parseDocument({ formatVersion: 99 })).toThrow(/더 새로운 형식/);
  });
  it('migrates v1 and records history', () => {
    const v1 = {
      formatVersion: 1,
      docId: 'd1',
      meta: { title: 't' },
      theme: {},
      slides: [
        {
          id: 's',
          bg: '#112233',
          elements: [
            {
              id: 'e',
              type: 'text',
              frame: { x: 0, y: 0, w: 10, h: 10 },
              content: { type: 'doc', content: [] },
              style: { fontSize: 72 },
            },
          ],
        },
      ],
    };
    const doc = parseDocument(v1, () => '2026-11-02T00:00:00Z');
    expect(doc.formatVersion).toBe(2);
    expect(doc.migrationHistory).toEqual([{ from: 1, to: 2, at: '2026-11-02T00:00:00Z' }]);
    expect(doc.slides[0]!.background).toEqual({ type: 'solid', color: '#112233' });
    const el = doc.slides[0]!.elements[0]!;
    expect(el.type === 'text' && el.style.fontSizePx).toBe(72);
  });
  it('canonicalJson is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: { d: 1, c: 2 } })).toBe(
      canonicalJson({ a: { c: 2, d: 1 }, b: 1 }),
    );
  });
  it('normalizedForCompare ignores save metadata only', () => {
    const doc = createDocument();
    expect(normalizedForCompare({ ...doc, lastSavedAt: 'x' })).toBe(normalizedForCompare(doc));
    expect(normalizedForCompare({ ...doc, docId: 'other' })).not.toBe(normalizedForCompare(doc));
  });
});

describe('text helpers', () => {
  it('round-trips plain text lines including empty ones', () => {
    expect(plainTextFromDoc(docFromPlainText('가\n\n나'))).toBe('가\n\n나');
  });
});

describe('commands and history', () => {
  const setup = () => {
    const doc = createDocument();
    const slideId = doc.slides[0]!.id;
    const a = createTextElement('A');
    const b = createShapeElement();
    const r = applyCommands(doc, [
      { type: 'element.add', slideId, element: a },
      { type: 'element.add', slideId, element: b },
    ]);
    return { doc: r.doc, slideId, a, b };
  };

  it('a patch cannot reach Object.prototype', () => {
    const { doc, slideId, a } = setup();
    const patch = JSON.parse(
      '{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}}}',
    );
    applyCommands(doc, [{ type: 'element.update', slideId, elementId: a.id, patch }]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('undoes and redoes through patches, including z-order', () => {
    const { doc, slideId, a } = setup();
    const r = applyCommands(doc, [
      { type: 'element.reorder', slideId, elementIds: [a.id], to: 'front' },
    ]);
    expect(r.doc.slides[0]!.elements.at(-1)!.id).toBe(a.id);
    const history = pushHistory(emptyHistory(), {
      label: 'z',
      patches: r.patches,
      inverse: r.inverse,
      at: 0,
    });
    const u = undo(r.doc, history)!;
    expect(u.doc.slides[0]!.elements[0]!.id).toBe(a.id);
    const re = redo(u.doc, u.history)!;
    expect(re.doc.slides[0]!.elements.at(-1)!.id).toBe(a.id);
  });

  it('coalesces typing into one undo step within the window', () => {
    const { doc, slideId, a } = setup();
    let cur = doc;
    let history = emptyHistory();
    for (const [i, t] of ['ㅎ', '하', '한'].entries()) {
      const r = applyCommands(cur, [
        {
          type: 'element.update',
          slideId,
          elementId: a.id,
          patch: { content: docFromPlainText(t) },
        },
      ]);
      cur = r.doc;
      history = pushHistory(history, {
        label: 'type',
        patches: r.patches,
        inverse: r.inverse,
        coalesceKey: `text:${a.id}`,
        at: i * 100,
      });
    }
    expect(history.past).toHaveLength(1);
    const u = undo(cur, history)!;
    const el = u.doc.slides[0]!.elements.find((e) => e.id === a.id)!;
    expect(el.type === 'text' && plainTextFromDoc(el.content)).toBe('A');
  });

  it('does not coalesce after the window', () => {
    let history = emptyHistory();
    history = pushHistory(history, {
      label: 'x',
      patches: [],
      inverse: [],
      coalesceKey: 'k',
      at: 0,
    });
    history = pushHistory(history, {
      label: 'x',
      patches: [],
      inverse: [],
      coalesceKey: 'k',
      at: 5000,
    });
    expect(history.past).toHaveLength(2);
  });

  it('replaces (does not blend) discriminated fills', () => {
    const { doc, slideId, b } = setup();
    const r = applyCommands(doc, [
      {
        type: 'element.update',
        slideId,
        elementId: b.id,
        patch: {
          fill: {
            type: 'linear',
            angle: 90,
            stops: [
              { offset: 0, color: '#000' },
              { offset: 1, color: '#fff' },
            ],
          },
        },
      },
    ]);
    const el = r.doc.slides[0]!.elements.find((e) => e.id === b.id)!;
    expect(el.type === 'shape' && el.fill).not.toHaveProperty('color');
  });

  it('duplicates a slide with fresh ids and remapped groups', () => {
    const { doc, slideId, a, b } = setup();
    const grouped = applyCommands(doc, [
      { type: 'element.group', slideId, elementIds: [a.id, b.id] },
    ]).doc;
    const r = applyCommands(grouped, [{ type: 'slide.duplicate', slideId }]);
    const [orig, copy] = r.doc.slides;
    expect(copy!.id).not.toBe(orig!.id);
    expect(copy!.elements[0]!.id).not.toBe(orig!.elements[0]!.id);
    expect(copy!.elements[0]!.groupId).toBeDefined();
    expect(copy!.elements[0]!.groupId).toBe(copy!.elements[1]!.groupId);
    expect(copy!.elements[0]!.groupId).not.toBe(orig!.elements[0]!.groupId);
  });

  it('refuses to delete the last slide', () => {
    const doc = createDocument();
    expect(() =>
      applyCommands(doc, [{ type: 'slide.delete', slideId: doc.slides[0]!.id }]),
    ).toThrow();
  });

  it('never mutates its input', () => {
    const { doc, slideId, a } = setup();
    const before = JSON.stringify(doc);
    applyCommands(doc, [{ type: 'element.delete', slideId, elementIds: [a.id] }]);
    expect(JSON.stringify(doc)).toBe(before);
  });
});
