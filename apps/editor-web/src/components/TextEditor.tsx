import { useEffect, useRef } from 'react';
import { Extension } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Color, TextStyle as TextStyleMark } from '@tiptap/extension-text-style';
import { Bold, Italic, List, ListOrdered, Strikethrough, Underline } from 'lucide-react';
import { cssColorToHex } from '@hps/import-legacy-html';
import { fontStack } from '@hps/slide-renderer';
import type { RichDoc, RichNode, TextElement, Theme } from '@hps/document-core';

/**
 * Text attributes the schema carries but stock TipTap would drop on edit. Without this, opening a
 * converted text box and typing one letter would silently lose its run sizes.
 */
const TextStyleExtras = Extension.create({
  name: 'hpsTextStyleExtras',
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSizePx: {
            default: null,
            parseHTML: (el: HTMLElement) => parseFloat(el.style.fontSize) || null,
            renderHTML: (a: { fontSizePx?: number | null }) =>
              a.fontSizePx ? { style: `font-size:${a.fontSizePx}px` } : {},
          },
          fontFamily: {
            default: null,
            parseHTML: (el: HTMLElement) =>
              el.style.fontFamily.replace(/["']/g, '').split(',')[0]?.trim() || null,
            renderHTML: (a: { fontFamily?: string | null }) =>
              a.fontFamily
                ? { style: `font-family:'${a.fontFamily.replace(/['"\\;{}<>]/g, '')}'` }
                : {},
          },
        },
      },
    ];
  },
});

const ALLOWED_MARKS = new Set([
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'link',
  'textStyle',
]);
const ALLOWED_NODES = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'text',
  'hardBreak',
]);

/**
 * Normalise editor output to the schema: pasted rgb() colours become hex, and pasted structures the
 * schema has no room for are unwrapped. Otherwise a paste could make the document fail to save later.
 */
export function normalizeRich(json: unknown): RichDoc {
  const fixNode = (node: Record<string, unknown>): RichNode[] => {
    const type = node.type as string;
    const kids = ((node.content as Record<string, unknown>[] | undefined) ?? []).flatMap(fixNode);
    if (!ALLOWED_NODES.has(type)) return kids;
    if (type === 'text') {
      const marks = ((node.marks as Record<string, unknown>[] | undefined) ?? [])
        .filter((m) => ALLOWED_MARKS.has(m.type as string))
        .map((m) => {
          if (m.type !== 'textStyle') return m;
          const a = (m.attrs ?? {}) as Record<string, unknown>;
          const color = typeof a.color === 'string' ? cssColorToHex(a.color) : null;
          return {
            type: 'textStyle',
            attrs: { color, fontSizePx: a.fontSizePx ?? null, fontFamily: a.fontFamily ?? null },
          };
        });
      return [
        { type: 'text', text: node.text as string, ...(marks.length ? { marks } : {}) } as RichNode,
      ];
    }
    if (type === 'hardBreak') return [{ type: 'hardBreak' }];
    return [
      {
        type,
        ...(node.attrs ? { attrs: node.attrs } : {}),
        ...(kids.length ? { content: kids } : {}),
      } as RichNode,
    ];
  };
  const content = ((json as { content?: Record<string, unknown>[] }).content ?? []).flatMap(
    fixNode,
  );
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

interface Props {
  element: TextElement;
  theme: Theme;
  zoom: number;
  onChange(doc: RichDoc): void;
  onDone(): void;
}

export function TextEditor({ element, theme, zoom, onChange, onDone }: Props) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const composing = useRef(false);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: false } }),
      TextStyleMark,
      Color,
      TextStyleExtras,
    ],
    content: element.content,
    autofocus: 'end',
    editorProps: {
      attributes: { 'aria-label': '글자 편집', 'data-testid': 'text-editor' },
      handleKeyDown: (_v, e) => {
        if (e.key === 'Escape') {
          onDone();
          return true;
        }
        return false;
      },
      handleDOMEvents: {
        // During Korean composition the text is provisional; committing then would corrupt undo.
        compositionstart: () => {
          composing.current = true;
          return false;
        },
        compositionend: () => {
          composing.current = false;
          return false;
        },
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (!composing.current) onChangeRef.current(normalizeRich(ed.getJSON()));
    },
  });

  useEffect(() => {
    if (!editor) return;
    const flush = (): void => onChangeRef.current(normalizeRich(editor.getJSON()));
    // IME completion arrives after the last transaction in some browsers.
    const dom = editor.view.dom;
    dom.addEventListener('compositionend', flush);
    return () => dom.removeEventListener('compositionend', flush);
  }, [editor]);

  const s = element.style;
  const f = element.frame;
  const justify =
    s.valign === 'middle' ? 'center' : s.valign === 'bottom' ? 'flex-end' : 'flex-start';
  const btn = (label: string, Icon: typeof Bold, active: boolean, run: () => void) => (
    <button
      type="button"
      className={`icon-btn${active ? ' on' : ''}`}
      aria-label={label}
      aria-pressed={active}
      // Keeps focus (and the selection) in the editor.
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  );

  return (
    <>
      {editor && (
        <div
          className="text-toolbar"
          role="toolbar"
          aria-label="글자 서식"
          style={{
            left: f.x,
            top: f.y,
            transform: `translateY(calc(-100% - ${8 / zoom}px)) scale(${1 / zoom})`,
            transformOrigin: 'left bottom',
          }}
        >
          {btn('굵게', Bold, editor.isActive('bold'), () =>
            editor.chain().focus().toggleBold().run(),
          )}
          {btn('기울임', Italic, editor.isActive('italic'), () =>
            editor.chain().focus().toggleItalic().run(),
          )}
          {btn('밑줄', Underline, editor.isActive('underline'), () =>
            editor.chain().focus().toggleUnderline().run(),
          )}
          {btn('취소선', Strikethrough, editor.isActive('strike'), () =>
            editor.chain().focus().toggleStrike().run(),
          )}
          {btn('글머리 기호', List, editor.isActive('bulletList'), () =>
            editor.chain().focus().toggleBulletList().run(),
          )}
          {btn('번호 매기기', ListOrdered, editor.isActive('orderedList'), () =>
            editor.chain().focus().toggleOrderedList().run(),
          )}
          <label className="color-field" onMouseDown={(e) => e.stopPropagation()}>
            <span className="sr-only">글자색</span>
            <input
              type="color"
              defaultValue="#000000"
              onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
            />
          </label>
        </div>
      )}
      <div
        className="hps-el hps-text-editing"
        style={{
          left: f.x,
          top: f.y,
          width: f.w,
          height: f.h,
          transform: f.rotate ? `rotate(${f.rotate}deg)` : undefined,
          zIndex: 10000,
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onBlur={(e) => {
          if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) onDone();
        }}
      >
        <div
          className="hps-text"
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: justify,
            fontFamily: fontStack(s.fontFamily, theme),
            fontSize: s.fontSizePx,
            lineHeight: s.lineHeight,
            fontWeight: s.fontWeight,
            fontStyle: s.italic ? 'italic' : undefined,
            color: s.color ?? theme.tokens.foreground,
            textAlign: s.align,
            letterSpacing: s.letterSpacingPx || undefined,
            padding: s.padding,
            ['--hps-para' as string]: `${s.paragraphSpacingPx}px`,
          }}
        >
          <EditorContent editor={editor} className="hps-text-body" />
        </div>
      </div>
    </>
  );
}
