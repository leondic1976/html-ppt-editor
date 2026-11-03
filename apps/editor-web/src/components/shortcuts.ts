import { useEffect } from 'react';
import { createTextElement, SlideElement } from '@hps/document-core';
import { useApp } from '../state/store';
import { insertImageFile, saveDocument } from '../lib/actions';

export const ELEMENT_MIME = 'application/x-hps-elements+json';

const isTyping = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  if (!el?.tagName) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
};

/** Selection expanded to whole groups, in the current slide. */
function selectedElements() {
  const { mode } = useApp.getState();
  if (mode?.kind !== 'native') return [];
  const slide = mode.doc.slides[mode.slideIndex]!;
  return slide.elements.filter((e) => mode.selection.includes(e.id));
}

export function nudge(dx: number, dy: number): void {
  const app = useApp.getState();
  const { mode } = app;
  if (mode?.kind !== 'native') return;
  const slide = mode.doc.slides[mode.slideIndex]!;
  const frames: Record<string, { x: number; y: number }> = {};
  for (const el of selectedElements()) {
    if (!el.locked) frames[el.id] = { x: el.frame.x + dx, y: el.frame.y + dy };
  }
  if (Object.keys(frames).length) {
    app.commit(
      [{ type: 'element.setFrames', slideId: slide.id, frames }],
      '이동',
      `nudge:${mode.selection.join()}`,
    );
  }
}

export function deleteSelection(): void {
  const app = useApp.getState();
  const { mode } = app;
  if (mode?.kind !== 'native') return;
  const ids = selectedElements()
    .filter((e) => !e.locked)
    .map((e) => e.id);
  if (ids.length) {
    app.commit(
      [{ type: 'element.delete', slideId: mode.doc.slides[mode.slideIndex]!.id, elementIds: ids }],
      '삭제',
    );
    app.setSelection([]);
  }
}

export function duplicateSelection(): void {
  const app = useApp.getState();
  const { mode } = app;
  if (mode?.kind !== 'native') return;
  const elements = selectedElements();
  if (!elements.length) return;
  const slide = mode.doc.slides[mode.slideIndex]!;
  const before = new Set(slide.elements.map((e) => e.id));
  if (app.commit([{ type: 'element.paste', slideId: slide.id, elements }], '복제')) {
    const m = useApp.getState().mode;
    if (m?.kind === 'native') {
      app.setSelection(
        m.doc.slides[m.slideIndex]!.elements.filter((e) => !before.has(e.id)).map((e) => e.id),
      );
    }
  }
}

export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const app = useApp.getState();
      const { mode } = app;
      const ctrl = e.ctrlKey || e.metaKey;
      if (app.presenting) return;
      if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (mode) void saveDocument(e.shiftKey);
        return;
      }
      if (!mode || isTyping(e.target)) return;
      if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) app.redo();
        else app.undo();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        app.redo();
        return;
      }
      if (e.key === 'F5') {
        e.preventDefault();
        app.setPresenting({ startAt: e.shiftKey ? (mode.slideIndex ?? 0) : 0 });
        return;
      }
      if (mode.kind !== 'native') return;

      const slide = mode.doc.slides[mode.slideIndex]!;
      const step = e.shiftKey ? 10 : 1;
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown':
          if (mode.selection.length) {
            e.preventDefault();
            nudge(
              e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
              e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0,
            );
          }
          return;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          deleteSelection();
          return;
        case 'Escape':
          app.setSelection([]);
          return;
        case 'Tab': {
          // Keyboard route through elements, for people who cannot point at the canvas.
          if (!slide.elements.length) return;
          e.preventDefault();
          const order = [...slide.elements].sort((a, b) => a.zIndex - b.zIndex);
          const cur = order.findIndex((x) => x.id === mode.selection[0]);
          const next = order[(cur + (e.shiftKey ? order.length - 1 : 1)) % order.length]!;
          app.setSelection([next.id]);
          return;
        }
        case 'Enter':
          if (mode.selection.length === 1 && selectedElements()[0]?.type === 'text') {
            e.preventDefault();
            app.setEditing(mode.selection[0]!);
          }
          return;
      }
      if (!ctrl) return;
      switch (e.key.toLowerCase()) {
        case 'a':
          e.preventDefault();
          app.setSelection(slide.elements.filter((x) => !x.locked).map((x) => x.id));
          break;
        case 'd':
          // Claims Ctrl+D from the browser's bookmark action while the editor has focus.
          e.preventDefault();
          duplicateSelection();
          break;
        case 'g':
          e.preventDefault();
          if (mode.selection.length) {
            app.commit(
              [
                {
                  type: e.shiftKey ? 'element.ungroup' : 'element.group',
                  slideId: slide.id,
                  elementIds: mode.selection,
                },
              ],
              '그룹',
            );
          }
          break;
      }
    };

    const onCopy = (e: ClipboardEvent, cut = false): void => {
      if (isTyping(e.target)) return;
      const elements = selectedElements();
      if (!elements.length || !e.clipboardData) return;
      e.clipboardData.setData(ELEMENT_MIME, JSON.stringify(elements));
      e.clipboardData.setData('text/plain', elements.map((x) => x.name ?? x.type).join('\n'));
      e.preventDefault();
      if (cut) deleteSelection();
    };

    const onPaste = (e: ClipboardEvent): void => {
      const app = useApp.getState();
      const { mode } = app;
      if (mode?.kind !== 'native' || isTyping(e.target) || !e.clipboardData) return;
      const slide = mode.doc.slides[mode.slideIndex]!;
      const own = e.clipboardData.getData(ELEMENT_MIME);
      if (own) {
        e.preventDefault();
        try {
          const raw = JSON.parse(own) as unknown[];
          // Clipboard contents are untrusted: another page can write this format too.
          const parsed = raw.map((x) => SlideElement.parse(x));
          const usable = parsed.filter((el) => {
            const assetId = el.type === 'image' || el.type === 'svg' ? el.assetId : null;
            return !assetId || mode.assets.has(assetId);
          });
          if (usable.length < parsed.length)
            app.notify('warning', '다른 문서의 사진은 함께 붙여넣을 수 없습니다.');
          if (usable.length)
            app.commit(
              [{ type: 'element.paste', slideId: slide.id, elements: usable }],
              '붙여넣기',
            );
        } catch {
          app.notify('warning', '클립보드 내용을 사용할 수 없습니다.');
        }
        return;
      }
      const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
      if (file) {
        e.preventDefault();
        void insertImageFile(file);
        return;
      }
      const text = e.clipboardData.getData('text/plain');
      if (text.trim()) {
        e.preventDefault();
        const el = createTextElement(text.slice(0, 100_000));
        if (app.commit([{ type: 'element.add', slideId: slide.id, element: el }], '글자 붙여넣기'))
          app.setSelection([el.id]);
      }
    };

    const onCut = (e: ClipboardEvent): void => onCopy(e, true);
    const copy = (e: ClipboardEvent): void => onCopy(e);
    window.addEventListener('keydown', onKey);
    document.addEventListener('copy', copy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('copy', copy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  }, []);
}
