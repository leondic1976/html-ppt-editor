import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
} from 'react';
import { contextFor, renderSlide } from '@hps/slide-renderer';
import type { Frame, SlideElement } from '@hps/document-core';
import {
  computeSnap,
  fitZoom,
  HANDLES,
  intersects,
  resizeFrame,
  rotatedBounds,
  rotationFromPointer,
  screenToModel,
  boundsOf,
  type Handle,
  type Rect,
  type SnapGuide,
} from '@hps/interaction';
import { useApp } from '../state/store';
import { refreshDerived } from '../lib/actions';
import { TextEditor } from './TextEditor';

type Drag =
  | { type: 'move'; startX: number; startY: number; start: Record<string, Frame>; moved: boolean }
  | { type: 'resize'; startX: number; startY: number; start: Frame; id: string; handle: Handle }
  | { type: 'rotate'; start: Frame; id: string }
  | { type: 'marquee'; startX: number; startY: number; x: number; y: number; additive: boolean };

const SAFE_MARGIN = 96;
const DEFAULT_PAGE = { width: 1920, height: 1080, unit: 'model-px', ratio: '16:9' } as const;

export function NativeCanvas() {
  const mode = useApp((s) => s.mode);
  const storedZoom = useApp((s) => s.zoom);
  const showSafe = useApp((s) => s.showSafeArea);
  const showGrid = useApp((s) => s.showGrid);
  const areaRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [area, setArea] = useState({ width: 800, height: 600 });
  const [live, setLive] = useState<Record<string, Frame> | null>(null);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);

  useEffect(() => {
    const node = areaRef.current;
    if (!node) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setArea({ width: e.contentRect.width, height: e.contentRect.height });
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const native = mode?.kind === 'native' ? mode : null;
  const doc = native?.doc;
  const assets = native?.assets;
  const slide = native ? native.doc.slides[native.slideIndex]! : null;
  const selection = native?.selection ?? [];
  const editingId = native?.editingId ?? null;
  const page = doc?.page ?? DEFAULT_PAGE;
  const zoom = storedZoom ?? fitZoom(page, area);

  const html = useMemo(
    () =>
      slide && doc && assets
        ? renderSlide(slide, contextFor(doc, { mode: 'src', url: (id) => assets.get(id) }))
        : '',
    [slide, doc, assets],
  );

  useEffect(() => {
    void refreshDerived();
  }, [slide]);

  // Dragging touches DOM styles directly and leaves the document alone until the pointer lifts.
  useEffect(() => {
    const root = slideRef.current;
    if (!root || !live) return;
    for (const [id, f] of Object.entries(live)) {
      const node = root.querySelector<HTMLElement>(`[data-el-id="${CSS.escape(id)}"]`);
      if (!node) continue;
      node.style.left = `${f.x}px`;
      node.style.top = `${f.y}px`;
      node.style.width = `${f.w}px`;
      node.style.height = `${f.h}px`;
      node.style.transform = f.rotate ? `rotate(${f.rotate}deg)` : '';
    }
  }, [live]);

  const modelPoint = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const r = slideRef.current!.getBoundingClientRect();
      return {
        x: screenToModel(e.clientX - r.left, zoom),
        y: screenToModel(e.clientY - r.top, zoom),
      };
    },
    [zoom],
  );

  const withGroups = useCallback(
    (ids: string[]): string[] => {
      if (!slide) return ids;
      const groups = new Set(
        slide.elements.filter((e) => ids.includes(e.id) && e.groupId).map((e) => e.groupId),
      );
      return slide.elements
        .filter((e) => ids.includes(e.id) || (e.groupId && groups.has(e.groupId)))
        .map((e) => e.id);
    },
    [slide],
  );

  const finishDrag = useCallback((frames: Record<string, Frame> | null, label: string) => {
    setGuides([]);
    if (!frames) return setLive(null);
    const app = useApp.getState();
    const m = app.mode;
    if (m?.kind !== 'native') return setLive(null);
    const cur = m.doc.slides[m.slideIndex]!;
    const updates: Record<string, Partial<Frame>> = {};
    const extra: Parameters<typeof app.commit>[0] = [];
    for (const [id, f] of Object.entries(frames)) {
      const before = cur.elements.find((x) => x.id === id);
      if (!before) continue;
      const b = before.frame;
      if (b.x === f.x && b.y === f.y && b.w === f.w && b.h === f.h && b.rotate === f.rotate)
        continue;
      updates[id] = {
        x: Math.round(f.x),
        y: Math.round(f.y),
        w: Math.round(f.w),
        h: Math.round(f.h),
        rotate: Math.round(f.rotate),
      };
      if (before.type === 'line' && (b.w !== f.w || b.h !== f.h)) {
        // A line's points live in frame coordinates, so they scale along with it.
        const sx = b.w > 0 ? f.w / b.w : 1;
        const sy = b.h > 0 ? f.h / b.h : 1;
        const p = before.points;
        extra.push({
          type: 'element.update',
          slideId: cur.id,
          elementId: id,
          patch: { points: { x1: p.x1 * sx, y1: p.y1 * sy, x2: p.x2 * sx, y2: p.y2 * sy } },
        });
      }
    }
    if (Object.keys(updates).length)
      app.commit(
        [{ type: 'element.setFrames', slideId: cur.id, frames: updates }, ...extra],
        label,
      );
    setLive(null);
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const d = dragRef.current;
      const m = useApp.getState().mode;
      if (!d || m?.kind !== 'native') return;
      const cur = m.doc.slides[m.slideIndex]!;
      const p = modelPoint(e);
      const threshold = 8 / zoom;
      if (d.type === 'move') {
        let dx = p.x - d.startX;
        let dy = p.y - d.startY;
        if (!d.moved && Math.hypot(dx, dy) < 3 / zoom) return;
        d.moved = true;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        const moving = boundsOf(
          Object.values(d.start).map((f) => rotatedBounds({ ...f, x: f.x + dx, y: f.y + dy })),
        )!;
        const others = cur.elements
          .filter((x) => !d.start[x.id] && !x.hidden)
          .map((x) => rotatedBounds(x.frame));
        const snap = e.altKey
          ? { dx: 0, dy: 0, guides: [] }
          : computeSnap({
              moving,
              others,
              page,
              threshold,
              ...(showSafe ? { safeMargin: SAFE_MARGIN } : {}),
            });
        const next: Record<string, Frame> = {};
        for (const [id, f] of Object.entries(d.start))
          next[id] = { ...f, x: f.x + dx + snap.dx, y: f.y + dy + snap.dy };
        setLive(next);
        setGuides(snap.guides);
      } else if (d.type === 'resize') {
        const el = cur.elements.find((x) => x.id === d.id);
        const keepRatio = e.shiftKey || el?.type === 'image' || el?.type === 'svg';
        const next = resizeFrame(d.start, d.handle, p.x - d.startX, p.y - d.startY, {
          keepRatio: keepRatio && !(e.shiftKey && (el?.type === 'image' || el?.type === 'svg')),
          fromCenter: e.ctrlKey,
        });
        setLive({ [d.id]: next });
      } else if (d.type === 'rotate') {
        setLive({
          [d.id]: {
            ...d.start,
            rotate: rotationFromPointer(d.start, p.x, p.y, e.shiftKey ? 15 : undefined),
          },
        });
      } else if (d.type === 'marquee') {
        d.x = p.x;
        d.y = p.y;
        setMarquee({
          x: Math.min(d.startX, p.x),
          y: Math.min(d.startY, p.y),
          w: Math.abs(p.x - d.startX),
          h: Math.abs(p.y - d.startY),
        });
      }
    };
    const onUp = (): void => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      const app = useApp.getState();
      if (d.type === 'marquee') {
        const m = app.mode;
        setMarquee(null);
        if (m?.kind === 'native') {
          const box = {
            x: Math.min(d.startX, d.x),
            y: Math.min(d.startY, d.y),
            w: Math.abs(d.x - d.startX),
            h: Math.abs(d.y - d.startY),
          };
          const cur = m.doc.slides[m.slideIndex]!;
          if (box.w > 4 || box.h > 4) {
            const hit = cur.elements
              .filter((x) => !x.locked && !x.hidden && intersects(box, rotatedBounds(x.frame)))
              .map((x) => x.id);
            app.setSelection(withGroups(d.additive ? [...new Set([...m.selection, ...hit])] : hit));
          } else if (!d.additive) app.setSelection([]);
        }
        return;
      }
      setLive((frames) => {
        finishDrag(
          d.type === 'move' && !d.moved ? null : frames,
          d.type === 'move' ? '이동' : d.type === 'resize' ? '크기 조절' : '회전',
        );
        return frames;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [modelPoint, zoom, page, showSafe, withGroups, finishDrag]);

  if (!native || !slide || !doc) return null;
  const app = useApp.getState();

  const onSlidePointerDown = (e: RPointerEvent): void => {
    if (e.button !== 0) return;
    const p = modelPoint(e);
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-el-id]');
    const id = target?.dataset.elId;
    const el = id ? slide.elements.find((x) => x.id === id) : undefined;
    if (editingId) app.setEditing(null);
    if (!el) {
      dragRef.current = {
        type: 'marquee',
        startX: p.x,
        startY: p.y,
        x: p.x,
        y: p.y,
        additive: e.shiftKey || e.ctrlKey,
      };
      return;
    }
    let next = selection;
    if (e.shiftKey || e.ctrlKey) {
      next = selection.includes(el.id)
        ? selection.filter((x) => x !== el.id)
        : [...selection, el.id];
      next = selection.includes(el.id) ? next : withGroups(next);
    } else if (!selection.includes(el.id)) next = e.altKey ? [el.id] : withGroups([el.id]);
    app.setSelection(next);
    const start: Record<string, Frame> = {};
    for (const x of slide.elements) if (next.includes(x.id) && !x.locked) start[x.id] = x.frame;
    if (Object.keys(start).length)
      dragRef.current = { type: 'move', startX: p.x, startY: p.y, start, moved: false };
    e.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur?.();
  };

  const onDoubleClick = (e: React.MouseEvent): void => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-el-id]')?.dataset.elId;
    const el = id ? slide.elements.find((x) => x.id === id) : undefined;
    if (el?.type === 'text' && !el.locked) {
      app.setSelection([el.id]);
      app.setEditing(el.id);
    }
  };

  const selectedEls = slide.elements.filter((x) => selection.includes(x.id));
  const frameOf = (el: SlideElement): Frame => live?.[el.id] ?? el.frame;
  const single = selectedEls.length === 1 ? selectedEls[0]! : null;
  const editing = editingId ? slide.elements.find((x) => x.id === editingId) : undefined;
  const handleSize = 12 / zoom;

  return (
    <main className="canvas-area" ref={areaRef} aria-label="슬라이드 편집 영역">
      <div className="stage" style={{ width: page.width * zoom, height: page.height * zoom }}>
        <div
          className="stage-inner"
          style={{ width: page.width, height: page.height, transform: `scale(${zoom})` }}
          data-testid="canvas"
        >
          <div
            ref={slideRef}
            className="canvas-slide"
            data-testid="canvas-slide"
            onPointerDown={onSlidePointerDown}
            onDoubleClick={onDoubleClick}
            dangerouslySetInnerHTML={{ __html: html }}
          />
          {editing?.type === 'text' && (
            <style>{`[data-el-id="${CSS.escape(editing.id)}"]{visibility:hidden}`}</style>
          )}
          {showGrid && <div className="grid-overlay" />}
          {showSafe && <div className="safe-overlay" style={{ inset: SAFE_MARGIN }} />}
          {guides.map((g, i) => (
            <div
              key={i}
              className={`guide guide-${g.axis}`}
              style={
                g.axis === 'x' ? { left: g.at, width: 2 / zoom } : { top: g.at, height: 2 / zoom }
              }
            />
          ))}
          {marquee && (
            <div
              className="marquee"
              style={{
                left: marquee.x,
                top: marquee.y,
                width: marquee.w,
                height: marquee.h,
                borderWidth: 1.5 / zoom,
              }}
            />
          )}
          {!editing &&
            selectedEls.map((el) => {
              const f = frameOf(el);
              return (
                <div
                  key={el.id}
                  className={`sel-box${el.locked ? ' sel-locked' : ''}`}
                  data-testid="selection-box"
                  style={{
                    left: f.x,
                    top: f.y,
                    width: f.w,
                    height: f.h,
                    transform: f.rotate ? `rotate(${f.rotate}deg)` : undefined,
                    borderWidth: 2 / zoom,
                  }}
                >
                  {single && !el.locked && (
                    <>
                      {HANDLES.map((h) => (
                        <div
                          key={h}
                          className={`handle handle-${h}`}
                          data-testid={`handle-${h}`}
                          style={{
                            width: handleSize,
                            height: handleSize,
                            margin: -handleSize / 2,
                            borderWidth: 1.5 / zoom,
                          }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            const p = modelPoint(e);
                            dragRef.current = {
                              type: 'resize',
                              startX: p.x,
                              startY: p.y,
                              start: el.frame,
                              id: el.id,
                              handle: h,
                            };
                          }}
                        />
                      ))}
                      <div
                        className="rotate-handle"
                        data-testid="rotate-handle"
                        style={{
                          width: handleSize,
                          height: handleSize,
                          top: -36 / zoom,
                          marginLeft: -handleSize / 2,
                          borderWidth: 1.5 / zoom,
                        }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          dragRef.current = { type: 'rotate', start: el.frame, id: el.id };
                        }}
                      />
                    </>
                  )}
                </div>
              );
            })}
          {editing?.type === 'text' && (
            <TextEditor
              key={editing.id}
              element={editing}
              theme={doc.theme}
              zoom={zoom}
              onChange={(content) =>
                app.commit(
                  [
                    {
                      type: 'element.update',
                      slideId: slide.id,
                      elementId: editing.id,
                      patch: { content },
                    },
                  ],
                  '글자 수정',
                  `text:${editing.id}`,
                )
              }
              onDone={() => app.setEditing(null)}
            />
          )}
        </div>
      </div>
    </main>
  );
}
