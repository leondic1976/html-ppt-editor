import { memo, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { ChevronDown, ChevronUp, Copy, Plus, Trash2 } from 'lucide-react';
import { contextFor, renderSlide } from '@hps/slide-renderer';
import type { DeckDocument, Slide } from '@hps/document-core';
import { useApp } from '../state/store';
import { LAYOUTS, slideFromLayout, type LayoutId } from '../lib/templates';

const THUMB_WIDTH = 176;

/** Renders only once scrolled into view, which keeps 100-slide decks responsive. */
const Thumb = memo(function Thumb({
  slide,
  doc,
  assets,
}: {
  slide: Slide;
  doc: DeckDocument;
  assets: Map<string, string>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setVisible(true);
      },
      { rootMargin: '300px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);
  const html = useMemo(
    () =>
      visible
        ? renderSlide(slide, contextFor(doc, { mode: 'src', url: (id) => assets.get(id) }))
        : '',
    [visible, slide, doc, assets],
  );
  const scale = THUMB_WIDTH / doc.page.width;
  return (
    <div
      ref={ref}
      className="thumb"
      style={{ width: THUMB_WIDTH, height: doc.page.height * scale }}
    >
      <div
        className="thumb-inner"
        style={{ transform: `scale(${scale})` }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
});

export function SlidePanel() {
  const mode = useApp((s) => s.mode);
  const [dragId, setDragId] = useState<string | null>(null);
  if (mode?.kind !== 'native') return null;
  const app = useApp.getState();
  const { doc, assets, slideIndex } = mode;
  const current = doc.slides[slideIndex]!;

  const addSlide = (layout: LayoutId): void => {
    const slide = slideFromLayout(layout, doc, current.background);
    if (app.commit([{ type: 'slide.add', index: slideIndex + 1, slide }], '슬라이드 추가'))
      app.setSlide(slideIndex + 1);
  };
  const onDrop = (e: DragEvent, to: number): void => {
    e.preventDefault();
    if (dragId) app.commit([{ type: 'slide.move', slideId: dragId, to }], '슬라이드 이동');
    setDragId(null);
  };

  return (
    <aside className="slide-panel" aria-label="슬라이드 목록">
      <div className="panel-toolbar">
        <label className="sr-only" htmlFor="new-slide-layout">
          새 슬라이드 레이아웃
        </label>
        <select
          id="new-slide-layout"
          className="select"
          value=""
          data-testid="add-slide-layout"
          onChange={(e) => {
            if (e.target.value) addSlide(e.target.value as LayoutId);
            e.target.value = '';
          }}
        >
          <option value="">레이아웃 추가…</option>
          {LAYOUTS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="icon-btn"
          aria-label="새 슬라이드"
          data-testid="add-slide"
          onClick={() => addSlide('titleBody')}
        >
          <Plus size={18} aria-hidden="true" />
        </button>
      </div>
      <ol className="slide-list">
        {doc.slides.map((slide, i) => (
          <li key={slide.id}>
            {slide.section && slide.section !== doc.slides[i - 1]?.section && (
              <div className="section-label">{slide.section}</div>
            )}
            <div
              role="button"
              tabIndex={0}
              aria-label={`슬라이드 ${i + 1}`}
              aria-current={i === slideIndex ? 'true' : undefined}
              data-testid={`slide-thumb-${i}`}
              className={`slide-item${i === slideIndex ? ' active' : ''}${slide.hidden ? ' slide-hidden' : ''}`}
              draggable
              onDragStart={() => setDragId(slide.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, i)}
              onClick={() => app.setSlide(i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  app.setSlide(i);
                }
              }}
            >
              <span className="slide-num">{i + 1}</span>
              <Thumb slide={slide} doc={doc} assets={assets} />
            </div>
            {i === slideIndex && (
              <div className="slide-actions">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="위로"
                  disabled={i === 0}
                  onClick={() =>
                    app.commit(
                      [{ type: 'slide.move', slideId: slide.id, to: i - 1 }],
                      '슬라이드 이동',
                    ) && app.setSlide(i - 1)
                  }
                >
                  <ChevronUp size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="아래로"
                  disabled={i === doc.slides.length - 1}
                  onClick={() =>
                    app.commit(
                      [{ type: 'slide.move', slideId: slide.id, to: i + 1 }],
                      '슬라이드 이동',
                    ) && app.setSlide(i + 1)
                  }
                >
                  <ChevronDown size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="슬라이드 복제"
                  data-testid="duplicate-slide"
                  onClick={() =>
                    app.commit([{ type: 'slide.duplicate', slideId: slide.id }], '슬라이드 복제') &&
                    app.setSlide(i + 1)
                  }
                >
                  <Copy size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="슬라이드 삭제"
                  disabled={doc.slides.length === 1}
                  onClick={() =>
                    app.commit([{ type: 'slide.delete', slideId: slide.id }], '슬라이드 삭제')
                  }
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
    </aside>
  );
}
