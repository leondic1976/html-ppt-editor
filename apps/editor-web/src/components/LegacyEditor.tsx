import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  editStyle,
  editText,
  elementById,
  measureSlide,
  originalPreview,
  pickEditable,
  PREVIEW_SANDBOX,
  previewFor,
  purifyPreview,
  readEditedBlock,
  replaceImage,
  showSlide,
  type JournalEntry,
} from '@hps/import-legacy-html';
import { fitZoom } from '@hps/interaction';
import { useApp, type LegacyState } from '../state/store';
import { IMAGE_ACCEPT, pickFile } from '../lib/actions';
import { prepareUserImage } from '../lib/files';

/** Sanitised preview in a frame with no script permission. The parent realm does all the work. */
function useFrameHtml(l: LegacyState, journalForPreview: JournalEntry[]): string {
  return useMemo(
    () =>
      purifyPreview(
        previewFor(l.session, journalForPreview, {
          allowExternal: l.allowExternal,
          localAssets: l.localAssets,
        }),
        window,
      ),
    // Rebuilds only on request: live edits are applied to the frame's DOM to keep the caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [l.session, l.frameVersion, l.allowExternal],
  );
}

function LegacyFrame({ l }: { l: LegacyState }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ width: 800, height: 600 });
  const [box, setBox] = useState({ width: 1920, height: 1080 });
  const editingRef = useRef<{ id: string; el: HTMLElement; before: string } | null>(null);
  const hoverRef = useRef<HTMLElement | null>(null);
  const zoomStored = useApp((s) => s.zoom);
  const html = useFrameHtml(l, l.journal);
  const session = l.session;

  useEffect(() => {
    const node = areaRef.current;
    if (!node) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setArea({ width: e.contentRect.width, height: e.contentRect.height });
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const applyCurrentSlide = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    const app = useApp.getState();
    const m = app.mode;
    if (m?.kind !== 'legacy') return;
    if (m.session.slides.length) {
      // Measure at full size so the slide's own width and height decide the stage.
      const frame = frameRef.current!;
      frame.style.width = '1920px';
      frame.style.height = '1080px';
      const el = showSlide(doc, m.session.slides, m.slideIndex);
      if (el) {
        const size = measureSlide(el);
        const next = {
          width: size.width > 100 ? size.width : 1920,
          height: size.height > 100 ? size.height : 1080,
        };
        frame.style.width = `${next.width}px`;
        frame.style.height = `${next.height}px`;
        setBox(next);
        el.scrollIntoView({ block: 'start', inline: 'start' });
        const r = el.getBoundingClientRect();
        doc.documentElement.scrollTo(
          doc.documentElement.scrollLeft + r.left,
          doc.documentElement.scrollTop + r.top,
        );
      }
    } else {
      const frame = frameRef.current!;
      frame.style.width = '1920px';
      frame.style.height = '1080px';
      setBox({ width: 1920, height: 1080 });
    }
  }, []);

  const finishEdit = useCallback((commit: boolean) => {
    const cur = editingRef.current;
    if (!cur) return;
    editingRef.current = null;
    cur.el.removeAttribute('contenteditable');
    cur.el.removeAttribute('data-hps-editing');
    const app = useApp.getState();
    const m = app.mode;
    if (m?.kind !== 'legacy') return;
    if (!commit) {
      cur.el.innerHTML = cur.before;
      return;
    }
    if (cur.el.innerHTML === cur.before) return;
    const next = editText(m.session, m.journal, cur.id, readEditedBlock(cur.el));
    cur.el.setAttribute('data-hps-changed', '');
    app.legacyCommit(next);
  }, []);

  const attach = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    const isEditable = (id: string): boolean =>
      session.index.texts.has(id) || session.index.images.has(id);
    const app = (): ReturnType<typeof useApp.getState> => useApp.getState();

    doc.addEventListener('mouseover', (e) => {
      if (editingRef.current) return;
      const hit = pickEditable(e.target as Element, isEditable);
      if (hoverRef.current && hoverRef.current !== hit?.el)
        hoverRef.current.removeAttribute('data-hps-hover');
      hit?.el.setAttribute('data-hps-hover', '');
      hoverRef.current = hit?.el ?? null;
    });
    doc.addEventListener('mouseleave', () => {
      hoverRef.current?.removeAttribute('data-hps-hover');
      hoverRef.current = null;
    });
    doc.addEventListener('click', (e) => {
      // A preview never navigates, whatever the file's links say.
      const target = e.target as Element;
      if (!target.closest('[data-hps-editing]')) e.preventDefault();
      if (editingRef.current && !target.closest('[data-hps-editing]')) finishEdit(true);
      if (editingRef.current) return;
      const hit = pickEditable(target, isEditable);
      doc
        .querySelectorAll('[data-hps-selected]')
        .forEach((n) => n.removeAttribute('data-hps-selected'));
      hit?.el.setAttribute('data-hps-selected', '');
      app().patchLegacy({ selectedId: hit?.id ?? null });
    });
    doc.addEventListener('dblclick', (e) => {
      const hit = pickEditable(e.target as Element, (id) => session.index.texts.has(id));
      if (!hit || editingRef.current) return;
      e.preventDefault();
      hit.el.removeAttribute('data-hps-hover');
      editingRef.current = { id: hit.id, el: hit.el, before: hit.el.innerHTML };
      // plaintext-only keeps pasted markup out of the block.
      hit.el.setAttribute('contenteditable', 'plaintext-only');
      hit.el.setAttribute('data-hps-editing', '');
      hit.el.focus();
    });
    doc.addEventListener('keydown', (e) => {
      if (editingRef.current) {
        if (e.key === 'Escape') {
          e.preventDefault();
          finishEdit(false);
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          finishEdit(true);
        }
        return;
      }
      // Key events do not cross into the parent, so editor shortcuts are forwarded here.
      const a = app();
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) a.redo();
        else a.undo();
      } else if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        a.redo();
      } else if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 's',
            ctrlKey: true,
            shiftKey: e.shiftKey,
            bubbles: true,
            cancelable: true,
          }),
        );
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        a.setSlide((a.mode?.slideIndex ?? 0) + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        a.setSlide((a.mode?.slideIndex ?? 0) - 1);
      }
    });
    doc.addEventListener('focusout', (e) => {
      if (editingRef.current && e.target === editingRef.current.el) finishEdit(true);
    });
    // No in-frame form or drag can act on the file.
    doc.addEventListener('submit', (e) => e.preventDefault());
    doc.addEventListener('dragstart', (e) => e.preventDefault());

    applyCurrentSlide();
  }, [session, applyCurrentSlide, finishEdit]);

  useEffect(() => {
    finishEdit(true);
    applyCurrentSlide();
  }, [l.slideIndex, applyCurrentSlide, finishEdit]);

  const zoom = zoomStored ?? fitZoom(box, area);
  return (
    <div className="canvas-area" ref={areaRef} aria-label="슬라이드 미리보기">
      <div className="stage" style={{ width: box.width * zoom, height: box.height * zoom }}>
        <iframe
          key={`${l.frameVersion}:${String(l.allowExternal)}`}
          ref={frameRef}
          title="가져온 슬라이드 (스크립트 실행 안 됨)"
          data-testid="legacy-frame"
          className="legacy-frame"
          sandbox={PREVIEW_SANDBOX}
          srcDoc={html}
          onLoad={attach}
          style={{ width: box.width, height: box.height, transform: `scale(${zoom})` }}
        />
      </div>
    </div>
  );
}

function CompareView({ l }: { l: LegacyState }) {
  const opts = useMemo(
    () => ({ allowExternal: l.allowExternal, localAssets: l.localAssets }),
    [l.allowExternal, l.localAssets],
  );
  const before = useMemo(
    () => purifyPreview(originalPreview(l.session, opts), window),
    [l.session, opts],
  );
  const after = useMemo(
    () => purifyPreview(previewFor(l.session, l.journal, opts), window),
    [l.session, l.journal, opts],
  );
  const sync = (e: React.SyntheticEvent<HTMLIFrameElement>): void => {
    const doc = e.currentTarget.contentDocument;
    if (doc && l.session.slides.length) showSlide(doc, l.session.slides, l.slideIndex);
  };
  const scale = 0.32;
  const frame = (html: string, label: string, id: string) => (
    <figure className="compare-pane">
      <figcaption>{label}</figcaption>
      <div className="compare-clip" style={{ width: 1920 * scale, height: 1080 * scale }}>
        <iframe
          key={`${id}-${l.slideIndex}`}
          title={label}
          data-testid={`compare-${id}`}
          sandbox={PREVIEW_SANDBOX}
          srcDoc={html}
          onLoad={sync}
          style={{
            width: 1920,
            height: 1080,
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
            border: 0,
            background: '#fff',
          }}
        />
      </div>
    </figure>
  );
  return (
    <div className="compare" data-testid="compare">
      {frame(before, '원본', 'before')}
      {frame(after, '수정본', 'after')}
    </div>
  );
}

function SlideRail({ l }: { l: LegacyState }) {
  const app = useApp.getState();
  const titles = useMemo(
    () =>
      l.session.slides.map((id, i) => {
        const prefix = `${id}/`;
        const first = [...l.session.index.texts.values()].find(
          (t) => t.id === id || t.id.startsWith(prefix),
        );
        return first?.text.replace(/\s+/g, ' ').trim().slice(0, 40) || `슬라이드 ${i + 1}`;
      }),
    [l.session],
  );
  return (
    <aside className="slide-panel" aria-label="슬라이드 목록">
      {l.session.slides.length === 0 && (
        <div className="panel-note">
          <p>슬라이드 구분을 찾지 못해 전체를 한 장으로 보여줍니다.</p>
          <button
            type="button"
            className="btn btn-block"
            data-testid="open-selector"
            onClick={() => app.setDialog({ type: 'slides-selector' })}
          >
            구분 직접 지정…
          </button>
        </div>
      )}
      <ol className="slide-list slide-list-text">
        {l.session.slides.map((id, i) => (
          <li key={id}>
            <button
              type="button"
              className={`slide-text-item${i === l.slideIndex ? ' active' : ''}`}
              aria-current={i === l.slideIndex ? 'true' : undefined}
              data-testid={`legacy-slide-${i}`}
              onClick={() => app.setSlide(i)}
            >
              <span className="slide-num">{i + 1}</span>
              <span>{titles[i]}</span>
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
}

const LEVEL_NOTE = [
  ['L1 원본 편집', '글자, 사진, 일부 서식을 고칩니다. 나머지는 바이트 단위로 그대로 남습니다.'],
  [
    'L2 요소 편집',
    '편집 메뉴에서 변환합니다. 위치와 크기를 옮길 수 있지만 레이아웃은 고정 좌표로 바뀝니다.',
  ],
  ['L3 화면 고정', '슬라이드를 그림으로 고정합니다. 외관은 유지되지만 글자는 고칠 수 없습니다.'],
] as const;

function LegacyPanel({ l }: { l: LegacyState }) {
  const app = useApp.getState();
  const id = l.selectedId;
  const text = id ? l.session.index.texts.get(id) : undefined;
  const image = id ? l.session.index.images.get(id) : undefined;
  const [draft, setDraft] = useState('');

  const frameDoc = (): Document | null =>
    document.querySelector<HTMLIFrameElement>('[data-testid="legacy-frame"]')?.contentDocument ??
    null;
  const liveEl = (): HTMLElement | null => {
    const doc = frameDoc();
    return doc && id ? elementById(doc, id) : null;
  };

  useEffect(() => {
    setDraft(liveEl()?.innerText ?? text?.text.trim() ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, l.frameVersion]);

  const applyText = (): void => {
    if (!id || !text) return;
    const el = liveEl();
    if (draft === (el?.innerText ?? text.text.trim())) return;
    app.legacyCommit(editText(l.session, l.journal, id, { text: draft }));
    if (el) {
      el.textContent = draft;
      el.setAttribute('data-hps-changed', '');
    }
  };

  const applyStyle = (prop: string, value: string): void => {
    if (!id) return;
    app.legacyCommit(editStyle(l.session, l.journal, id, { [prop]: value }));
    const el = liveEl();
    el?.style.setProperty(prop, value);
    el?.setAttribute('data-hps-changed', '');
  };

  const replace = async (): Promise<void> => {
    if (!id || !image) return;
    const [file] = await pickFile(IMAGE_ACCEPT);
    if (!file) return;
    try {
      const prepared = await prepareUserImage(new Uint8Array(await file.arrayBuffer()), file);
      const el = liveEl();
      const rect = el?.getBoundingClientRect();
      const box = rect && rect.width > 0 ? { width: rect.width, height: rect.height } : undefined;
      const next = replaceImage(l.session, l.journal, id, {
        dataUrl: prepared.dataUrl,
        ...(box ? { box } : {}),
      });
      app.legacyCommit(next, { rebuild: true });
      app.notify('success', '사진을 교체했습니다.');
    } catch (e) {
      app.notify('error', `사진을 넣지 않았습니다: ${(e as Error).message}`);
    }
  };

  const removeEntry = (entry: JournalEntry): void => {
    app.legacyCommit(
      l.journal.filter((e) => e !== entry),
      { rebuild: true },
    );
  };

  const computed = (prop: string): string => {
    const el = liveEl();
    return el
      ? (el.ownerDocument.defaultView?.getComputedStyle(el).getPropertyValue(prop) ?? '')
      : '';
  };
  const rgbHex = (v: string): string => {
    const m = /rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(v);
    return m
      ? `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`
      : '#000000';
  };

  return (
    <aside className="properties" aria-label="속성">
      {!id && (
        <section className="prop-section">
          <h3>원본 보존 편집</h3>
          <p className="muted">
            글자를 더블클릭해 고치고, 사진을 클릭해 교체하세요. 파란 점선이 고칠 수 있는 곳입니다.
            파일의 스크립트는 실행되지 않습니다.
          </p>
          <dl className="level-list">
            {LEVEL_NOTE.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {text && (
        <section className="prop-section">
          <h3>글자</h3>
          <textarea
            className="input"
            rows={4}
            aria-label="글자 내용"
            data-testid="legacy-text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={applyText}
          />
          {text.hasInlineChildren && (
            <p className="muted">
              여기서 고치면 이 블록의 부분 서식(굵게 등)이 사라집니다. 서식을 유지하려면 화면에서
              더블클릭해 고치세요.
            </p>
          )}
          <label className="prop-row">
            <span>글자 크기(px)</span>
            <input
              className="input"
              type="number"
              min={1}
              key={`fs-${id}`}
              data-testid="legacy-font-size"
              defaultValue={parseFloat(computed('font-size')) || undefined}
              onBlur={(e) => e.target.value && applyStyle('font-size', `${e.target.value}px`)}
            />
          </label>
          <label className="prop-row">
            <span>색</span>
            <input
              className="color-input"
              type="color"
              key={`c-${id}`}
              defaultValue={rgbHex(computed('color'))}
              onChange={(e) => applyStyle('color', e.target.value)}
            />
          </label>
          <label className="prop-row">
            <span>정렬</span>
            <select
              className="select"
              key={`a-${id}`}
              defaultValue={computed('text-align')}
              onChange={(e) => applyStyle('text-align', e.target.value)}
            >
              <option value="left">왼쪽</option>
              <option value="start">시작</option>
              <option value="center">가운데</option>
              <option value="right">오른쪽</option>
            </select>
          </label>
        </section>
      )}
      {image && (
        <section className="prop-section">
          <h3>사진</h3>
          <button
            type="button"
            className="btn btn-block"
            data-testid="legacy-replace-image"
            onClick={() => void replace()}
          >
            사진 교체…
          </button>
          <p className="muted">현재 표시 크기를 유지해 레이아웃이 밀리지 않게 합니다.</p>
        </section>
      )}
      <section className="prop-section">
        <h3>변경 내역 {l.journal.length}</h3>
        {l.journal.length === 0 ? (
          <p className="muted">아직 고친 곳이 없습니다.</p>
        ) : (
          <ul className="change-list" data-testid="change-list">
            {l.journal.map((entry, i) => (
              <li key={`${entry.key.path}-${i}`}>
                <span>{entry.label ?? entry.key.path}</span>
                <button
                  type="button"
                  className="link"
                  aria-label={`${entry.label ?? ''} 되돌리기`}
                  onClick={() => removeEntry(entry)}
                >
                  되돌리기
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {l.warnings.length > 0 && (
        <section className="prop-section warn-section">
          <h3>가져오기 경고 {l.warnings.length}</h3>
          <ul className="issue-list" data-testid="legacy-warnings">
            {l.warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
          <button
            type="button"
            className="link"
            onClick={() => app.setDialog({ type: 'import-report' })}
          >
            보고서 전체 보기
          </button>
        </section>
      )}
    </aside>
  );
}

export function LegacyEditor() {
  const mode = useApp((s) => s.mode);
  if (mode?.kind !== 'legacy') return null;
  return (
    <>
      <SlideRail l={mode} />
      {mode.compare ? <CompareView l={mode} /> : <LegacyFrame l={mode} />}
      <LegacyPanel l={mode} />
    </>
  );
}
