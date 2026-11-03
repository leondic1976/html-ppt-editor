/** List text indent in ems. The renderer and the PPTX export must agree, or list text shifts between them. */
export const LIST_INDENT_EM = 1.4;

import type { RichDoc, RichNode } from './schema.js';

/** Plain text (`\n` between lines) into a rich doc. */
export function docFromPlainText(text: string): RichDoc {
  return {
    type: 'doc',
    content: text.split(/\r?\n/).map((line) => ({
      type: 'paragraph' as const,
      ...(line ? { content: [{ type: 'text' as const, text: line }] } : {}),
    })),
  };
}

function collect(node: RichNode, out: string[]): void {
  if (node.type === 'text') out.push(node.text);
  else if (node.type === 'hardBreak') out.push('\n');
  else node.content?.forEach((c) => collect(c, out));
}

export function plainTextFromDoc(doc: RichDoc): string {
  const blocks: string[] = [];
  const walkBlock = (node: RichNode): void => {
    if (node.type === 'paragraph' || node.type === 'heading') {
      const out: string[] = [];
      collect(node, out);
      blocks.push(out.join(''));
    } else if (node.type !== 'text' && node.type !== 'hardBreak') {
      node.content?.forEach(walkBlock);
    }
  };
  doc.content.forEach(walkBlock);
  return blocks.join('\n');
}
