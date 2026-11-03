import { z } from 'zod';
import {
  applyCommands,
  createDocument,
  createSlide,
  createTextElement,
  DeckDocument,
  newId,
  parseDocument,
  SlideElement,
  type RichDoc,
  type RichNode,
  type Slide,
  type TextMark,
} from '@hps/document-core';

/** Published JSON Schema for LLMs and tools (plan scenario C). */
export const deckJsonSchema = (): unknown =>
  z.toJSONSchema(DeckDocument, { unrepresentable: 'any', io: 'input' });

export interface ImportedDeck {
  doc: DeckDocument;
  warnings: string[];
}

/** Model JSON from a tool or LLM: schema-validated, with field-level errors (DocumentValidationError). */
export function importDeckJson(text: string): ImportedDeck {
  const data: unknown = JSON.parse(text);
  const doc = parseDocument(data);
  const warnings: string[] = [];
  for (const slide of doc.slides) {
    for (const el of slide.elements) {
      if ((el.type === 'image' || el.type === 'svg') && !doc.assets[el.assetId]) {
        warnings.push(`이미지 ${el.id}의 자산 정보가 없어 빈 칸으로 표시됩니다.`);
      }
    }
  }
  return { doc, warnings };
}

function inlineMd(text: string): RichNode[] {
  const out: RichNode[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (t: string, marks?: TextMark[]): void => {
    if (t) out.push({ type: 'text', text: t, ...(marks ? { marks } : {}) });
  };
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index));
    if (m[2]) push(m[2], [{ type: 'bold' }]);
    else if (m[3]) push(m[3], [{ type: 'italic' }]);
    else if (m[4]) push(m[4], [{ type: 'code' }]);
    else if (m[5] && m[6]) {
      // Only safe schemes become links; the rest stay as plain text.
      if (/^(?:https?:|mailto:)/i.test(m[6])) push(m[5], [{ type: 'link', attrs: { href: m[6] } }]);
      else push(m[5]);
    }
    last = m.index + m[0].length;
  }
  push(text.slice(last));
  return out;
}

const PAGE_W = 1920;
const MARGIN = 120;

/** Markdown outline to slides. `---` or `# ` starts a slide; `Note:` lines become speaker notes. */
export function importMarkdown(md: string, title = '제목 없음'): ImportedDeck {
  const base = createDocument({ title, slideCount: 0 });
  const chunks: string[][] = [[]];
  for (const line of md.split(/\r?\n/)) {
    if (/^---+\s*$/.test(line)) {
      chunks.push([]);
      continue;
    }
    if (/^#\s/.test(line) && chunks[chunks.length - 1]!.some((l) => l.trim())) chunks.push([]);
    chunks[chunks.length - 1]!.push(line);
  }

  const slides: Slide[] = [];
  const warnings: string[] = [];
  for (const chunk of chunks) {
    if (!chunk.some((l) => l.trim())) continue;
    const slide = createSlide(base.theme);
    const heading = chunk.find((l) => /^#{1,3}\s/.test(l));
    const notes: string[] = [];
    const body: RichNode[] = [];
    let list: RichNode[] | null = null;
    const flush = (): void => {
      if (list) body.push({ type: 'bulletList', content: list });
      list = null;
    };
    for (const line of chunk) {
      if (line === heading) continue;
      const noteMatch = /^Note:\s*(.*)$/i.exec(line);
      if (noteMatch) {
        notes.push(noteMatch[1]!);
        continue;
      }
      const item = /^\s*[-*+]\s+(.*)$/.exec(line);
      if (item) {
        (list ??= []).push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: inlineMd(item[1]!) }],
        });
      } else if (line.trim()) {
        flush();
        body.push({ type: 'paragraph', content: inlineMd(line.trim()) });
      } else flush();
    }
    flush();
    if (/!\[[^\]]*\]\(/.test(chunk.join('\n'))) {
      warnings.push(
        `슬라이드 ${slides.length + 1}: Markdown 이미지는 가져오지 않습니다. 편집기에서 삽입하세요.`,
      );
    }

    const elements: SlideElement[] = [];
    if (heading) {
      const titleEl = createTextElement(heading.replace(/^#+\s*/, ''), {
        x: MARGIN,
        y: 90,
        w: PAGE_W - MARGIN * 2,
        h: 150,
      });
      titleEl.style.fontSizePx = 84;
      titleEl.style.fontWeight = 700;
      titleEl.zIndex = 0;
      elements.push(titleEl);
    }
    if (body.length) {
      const bodyEl = createTextElement('', {
        x: MARGIN,
        y: heading ? 280 : 120,
        w: PAGE_W - MARGIN * 2,
        h: 700,
      });
      bodyEl.content = { type: 'doc', content: body } as RichDoc;
      bodyEl.style.fontSizePx = 48;
      bodyEl.style.paragraphSpacingPx = 16;
      bodyEl.zIndex = 1;
      elements.push(bodyEl);
    }
    slides.push({ ...slide, id: newId('slide'), notes: notes.join('\n'), elements });
  }
  if (!slides.length) slides.push(createSlide(base.theme));
  const doc = applyCommands({ ...base, slides }, []).doc;
  return { doc: parseDocument(JSON.parse(JSON.stringify(doc))), warnings };
}
