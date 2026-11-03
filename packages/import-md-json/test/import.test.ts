import { describe, expect, it } from 'vitest';
import { createDocument, DocumentValidationError, plainTextFromDoc } from '@hps/document-core';
import { deckJsonSchema, importDeckJson, importMarkdown } from '@hps/import-md-json';

describe('JSON', () => {
  it('accepts a valid deck', () => {
    expect(importDeckJson(JSON.stringify(createDocument())).doc.slides).toHaveLength(1);
  });
  it('reports schema errors by path', () => {
    const bad = JSON.parse(JSON.stringify(createDocument()));
    bad.slides[0].elements.push({ id: 'x', type: 'text', frame: { x: 'a', y: 0, w: 1, h: 1 } });
    try {
      importDeckJson(JSON.stringify(bad));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DocumentValidationError);
    }
  });
  it('warns about images without asset data', () => {
    const doc = JSON.parse(JSON.stringify(createDocument()));
    doc.slides[0].elements.push({
      id: 'i',
      type: 'image',
      assetId: `sha256-${'a'.repeat(64)}`,
      frame: { x: 0, y: 0, w: 1, h: 1 },
    });
    expect(importDeckJson(JSON.stringify(doc)).warnings[0]).toContain('자산 정보');
  });
  it('publishes a JSON Schema', () => {
    const schema = deckJsonSchema() as { properties: Record<string, unknown> };
    expect(schema.properties.slides).toBeDefined();
    expect(schema.properties.formatVersion).toBeDefined();
  });
});

describe('Markdown', () => {
  const md = `# 첫 장\n본문 **굵게** *기울임*\n- 항목 1\n- [링크](https://a.b)\nNote: 발표 메모\n\n---\n\n## 둘째\n텍스트\n\n# 셋째\n[나쁜 링크](javascript:evil())\n![그림](a.png)`;
  const { doc, warnings } = importMarkdown(md, '문서');

  it('splits on --- and top headings', () => {
    expect(doc.slides).toHaveLength(3);
    expect(doc.meta.title).toBe('문서');
  });
  it('makes title and body elements, with marks and lists', () => {
    const [title, body] = doc.slides[0]!.elements;
    expect(title!.type === 'text' && plainTextFromDoc(title!.content)).toBe('첫 장');
    expect(JSON.stringify(body)).toContain('"bold"');
    expect(JSON.stringify(body)).toContain('bulletList');
  });
  it('turns Note: lines into speaker notes', () => {
    expect(doc.slides[0]!.notes).toBe('발표 메모');
  });
  it('refuses unsafe link schemes', () => {
    expect(JSON.stringify(doc)).not.toContain('javascript:');
    expect(JSON.stringify(doc.slides[2])).toContain('나쁜 링크');
  });
  it('warns that images are not imported', () => {
    expect(warnings.join()).toContain('Markdown 이미지');
  });
  it('never yields an empty deck', () => {
    expect(importMarkdown('').doc.slides).toHaveLength(1);
  });
});
