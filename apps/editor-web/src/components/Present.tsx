import { useEffect, useMemo, useRef, useState } from 'react';
import { contextFor, deckCss, renderSlide } from '@hps/slide-renderer';
import type { DeckDocument } from '@hps/document-core';
import { fitZoom } from '@hps/interaction';
import {
  measureSlide,
  PREVIEW_SANDBOX,
  previewFor,
  purifyPreview,
  showSlide,
} from '@hps/import-legacy-html';
import { useApp, type LegacyState, type NativeState } from '../state/store';
import { fontCss } from '../lib/actions';

const CHANNEL = 'hps-presenter';

type Msg =
  | { type: 'request' }
  | { type: 'state'; doc: DeckDocument; assets: [string, string][]; index: number }
  | { type: 'goto'; index: number }
  | { type: 'end' };

function useViewport(): { width: number; height: number } {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const on = (): void => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

function SlideImage({
  doc,
  assets,
  index,
  width,
  height,
}: {
  doc: DeckDocument;
  assets: Map<string, string>;
  index: number;
  width: number;
  height: number;
}) {
  const slide = doc.slides[index];
  const html = useMemo(
    () =>
      slide
        ? renderSlide(slide, contextFor(doc, { mode: 'src', url: (id) => assets.get(id) }))
        : '',
    [slide, doc, assets],
  );
  const zoom = fitZoom(doc.page, { width, height }, 0);
  return (
    <div
      style={{
        width: doc.page.width * zoom,
        height: doc.page.height * zoom,
        overflow: 'hidden',
        flex: 'none',
      }}
    >
      <div
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: '0 0',
          width: doc.page.width,
          height: doc.page.height,
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function NativePresent({ m, startAt, exit }: { m: NativeState; startAt: number; exit(): void }) {
  const visible = useMemo(
    () => m.doc.slides.map((s, i) => (s.hidden ? -1 : i)).filter((i) => i >= 0),
    [m.doc.slides],
  );
  const firstPos = Math.max(
    0,
    visible.findIndex((i) => i >= startAt),
  );
  const [pos, setPos] = useState(firstPos);
  const { width, height } = useViewport();
  const channel = useRef<BroadcastChannel | null>(null);
  const index = visible[pos] ?? 0;

  const go = (next: number): void => setPos(Math.max(0, Math.min(visible.length - 1, next)));

  const postState = useRef<() => void>(() => undefined);
  postState.current = () => {
    channel.current?.postMessage({
      type: 'state',
      doc: m.doc,
      assets: [...m.assets],
      index,
    } satisfies Msg);
  };

  useEffect(() => {
    const bc = new BroadcastChannel(CHANNEL);
    channel.current = bc;
    bc.onmessage = (e: MessageEvent<Msg>) => {
      if (e.data.type === 'goto') setPos(Math.max(0, visible.indexOf(e.data.index)));
      if (e.data.type === 'end') exit();
      // The presenter window usually finishes loading after the first state was sent.
      if (e.data.type === 'request') postState.current();
    };
    postState.current();
    return () => bc.close();
  }, [visible, exit]);

  useEffect(() => {
    postState.current();
  }, [index, m.doc, m.assets]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
        case 'Enter':
          e.preventDefault();
          setPos((p) => Math.min(visible.length - 1, p + 1));
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
        case 'Backspace':
          e.preventDefault();
          setPos((p) => Math.max(0, p - 1));
          break;
        case 'Home':
          setPos(0);
          break;
        case 'End':
          setPos(visible.length - 1);
          break;
        case 'Escape':
          exit();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, exit]);

  return (
    <div
      className="present"
      data-testid="present"
      onClick={(e) => go(pos + (e.clientX < window.innerWidth * 0.2 ? -1 : 1))}
    >
      <SlideImage doc={m.doc} assets={m.assets} index={index} width={width} height={height} />
      <div className="present-counter" data-testid="present-counter">
        {pos + 1} / {visible.length}
      </div>
    </div>
  );
}

function LegacyPresent({ l, startAt, exit }: { l: LegacyState; startAt: number; exit(): void }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [index, setIndex] = useState(startAt);
  const [box, setBox] = useState({ width: 1920, height: 1080 });
  const { width, height } = useViewport();
  const html = useMemo(
    () =>
      purifyPreview(
        previewFor(l.session, l.journal, {
          allowExternal: l.allowExternal,
          localAssets: l.localAssets,
        }),
        window,
      ),
    [l.session, l.journal, l.allowExternal, l.localAssets],
  );
  const count = Math.max(1, l.session.slides.length);

  const sync = (): void => {
    const doc = ref.current?.contentDocument;
    if (!doc || !l.session.slides.length) return;
    const el = showSlide(doc, l.session.slides, index);
    if (el) {
      const size = measureSlide(el);
      setBox({
        width: size.width > 100 ? size.width : 1920,
        height: size.height > 100 ? size.height : 1080,
      });
      el.scrollIntoView({ block: 'start', inline: 'start' });
    }
  };
  useEffect(sync);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key))
        setIndex((i) => Math.min(count - 1, i + 1));
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key))
        setIndex((i) => Math.max(0, i - 1));
      else if (e.key === 'Escape') exit();
    };
    window.addEventListener('keydown', onKey);
    const doc = ref.current?.contentDocument;
    doc?.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      doc?.removeEventListener('keydown', onKey);
    };
  }, [count, exit]);

  const zoom = fitZoom(box, { width, height }, 0);
  return (
    <div className="present" data-testid="present">
      <div style={{ width: box.width * zoom, height: box.height * zoom, overflow: 'hidden' }}>
        <iframe
          ref={ref}
          title="발표"
          sandbox={PREVIEW_SANDBOX}
          srcDoc={html}
          onLoad={() => {
            sync();
            const doc = ref.current?.contentDocument;
            doc?.addEventListener('click', (e) => {
              e.preventDefault();
              setIndex((i) => Math.min(count - 1, i + 1));
            });
            doc?.addEventListener('keydown', (e) => {
              if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key))
                setIndex((i) => Math.min(count - 1, i + 1));
              else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key))
                setIndex((i) => Math.max(0, i - 1));
              else if (e.key === 'Escape') exit();
            });
          }}
          style={{
            width: box.width,
            height: box.height,
            border: 0,
            transform: `scale(${zoom})`,
            transformOrigin: '0 0',
            background: '#fff',
          }}
        />
      </div>
      <div className="present-counter" data-testid="present-counter">
        {index + 1} / {count}
      </div>
    </div>
  );
}

export function PresentOverlay({ startAt }: { startAt: number }) {
  const mode = useApp((s) => s.mode);
  const setPresenting = useApp((s) => s.setPresenting);
  const rootRef = useRef<HTMLDivElement>(null);
  const exit = useRef(() => {
    setPresenting(null);
    if (document.fullscreenElement) void document.exitFullscreen();
  }).current;

  useEffect(() => {
    // Fullscreen needs the user's gesture and can be refused; presenting still works in the window.
    void rootRef.current?.requestFullscreen?.().catch(() => undefined);
    const onChange = (): void => {
      if (
        !document.fullscreenElement &&
        useApp.getState().presenting &&
        rootRef.current?.dataset.wasFull
      )
        exit();
      if (document.fullscreenElement && rootRef.current) rootRef.current.dataset.wasFull = '1';
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [exit]);

  if (!mode) return null;
  return (
    <div ref={rootRef} className="present-root">
      {mode.kind === 'native' ? (
        <NativePresent m={mode} startAt={startAt} exit={exit} />
      ) : (
        <LegacyPresent l={mode} startAt={startAt} exit={exit} />
      )}
    </div>
  );
}

export function openPresenterWindow(): void {
  const app = useApp.getState();
  const win = window.open(
    `${location.pathname}${location.search}#/presenter`,
    'hps-presenter',
    'width=1200,height=760',
  );
  if (!win) {
    app.notify(
      'warning',
      '팝업이 차단되어 발표자 보기를 열지 못했습니다. 이 사이트의 팝업을 허용하세요.',
    );
    return;
  }
  app.setPresenting({ startAt: app.mode?.slideIndex ?? 0 });
}

/** Separate window: current and next slide, notes, timer. Talks to the audience view over BroadcastChannel. */
export function PresenterView() {
  const [state, setState] = useState<{
    doc: DeckDocument;
    assets: Map<string, string>;
    index: number;
  } | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const { width, height } = useViewport();

  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    const bc = new BroadcastChannel(CHANNEL);
    channel.current = bc;
    bc.onmessage = (e: MessageEvent<Msg>) => {
      if (e.data.type === 'state') {
        setState({ doc: e.data.doc, assets: new Map(e.data.assets), index: e.data.index });
      }
    };
    bc.postMessage({ type: 'request' } satisfies Msg);
    return () => {
      clearInterval(t);
      bc.close();
    };
  }, []);

  const go = (delta: number): void => {
    if (!state) return;
    const visible = state.doc.slides.map((s, i) => (s.hidden ? -1 : i)).filter((i) => i >= 0);
    const pos = visible.indexOf(state.index);
    const next = visible[Math.max(0, Math.min(visible.length - 1, pos + delta))];
    if (next !== undefined)
      channel.current?.postMessage({ type: 'goto', index: next } satisfies Msg);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) go(1);
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) go(-1);
      else if (e.key === 'Escape') channel.current?.postMessage({ type: 'end' } satisfies Msg);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    document.title = '발표자 보기';
  }, []);

  if (!state) {
    return (
      <div className="presenter-wait">
        발표 창을 기다리는 중… 편집기에서 발표를 시작하면 연결됩니다.
      </div>
    );
  }
  const { doc, assets, index } = state;
  const visible = doc.slides.map((s, i) => (s.hidden ? -1 : i)).filter((i) => i >= 0);
  const pos = visible.indexOf(index);
  const nextIndex = visible[pos + 1];
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const fonts = Object.entries(doc.assets).filter(
    ([id, meta]) => meta.kind === 'font' && assets.has(id),
  ).length;
  return (
    <div className="presenter" data-testid="presenter">
      <style>
        {deckCss(doc.page)}
        {fonts ? fontCss({ doc, assets } as NativeState) : ''}
      </style>
      <div className="presenter-main">
        <SlideImage
          doc={doc}
          assets={assets}
          index={index}
          width={width * 0.62}
          height={height * 0.72}
        />
      </div>
      <div className="presenter-side">
        <div className="presenter-timer" data-testid="presenter-timer" aria-label="경과 시간">
          {mm}:{ss}
        </div>
        <div className="presenter-count">
          {pos + 1} / {visible.length}
        </div>
        <div className="presenter-next">
          <span>다음</span>
          {nextIndex !== undefined ? (
            <SlideImage
              doc={doc}
              assets={assets}
              index={nextIndex}
              width={width * 0.3}
              height={height * 0.3}
            />
          ) : (
            <p>마지막 슬라이드입니다.</p>
          )}
        </div>
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => go(-1)}>
            이전
          </button>
          <button type="button" className="btn btn-primary" onClick={() => go(1)}>
            다음
          </button>
        </div>
      </div>
      <div className="presenter-notes" data-testid="presenter-notes">
        {doc.slides[index]?.notes || <span className="muted">노트 없음</span>}
      </div>
    </div>
  );
}
