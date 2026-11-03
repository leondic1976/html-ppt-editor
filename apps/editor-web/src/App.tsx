import { useEffect, useState, type DragEvent } from 'react';
import { deckCss } from '@hps/slide-renderer';
import { useApp } from './state/store';
import { openFiles } from './lib/files';
import { fontCss, saveDocument } from './lib/actions';
import { Home } from './components/Home';
import { TopBar } from './components/TopBar';
import { SlidePanel } from './components/SlidePanel';
import { NativeCanvas } from './components/NativeCanvas';
import { Properties } from './components/Properties';
import { LegacyEditor } from './components/LegacyEditor';
import { Dialogs } from './components/Dialogs';
import { StatusBar } from './components/StatusBar';
import { PresentOverlay } from './components/Present';
import { useGlobalShortcuts } from './components/shortcuts';

export function App() {
  const mode = useApp((s) => s.mode);
  const dark = useApp((s) => s.dark);
  const notices = useApp((s) => s.notices);
  const dismiss = useApp((s) => s.dismiss);
  const busy = useApp((s) => s.busy);
  const presenting = useApp((s) => s.presenting);
  const dirty = useApp((s) => s.dirty);
  const [dragging, setDragging] = useState(false);
  useGlobalShortcuts();

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent): void => {
      if (useApp.getState().dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  useEffect(() => {
    const title =
      mode?.kind === 'native'
        ? mode.doc.meta.title
        : mode?.kind === 'legacy'
          ? mode.session.fileName
          : '';
    document.title = `${dirty ? '● ' : ''}${title ? `${title} — ` : ''}HTML-PPT Studio`;
  }, [mode, dirty]);

  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    setDragging(false);
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    if (mode?.kind === 'native' && files.every((f) => f.type.startsWith('image/'))) return;
    void openFiles(files);
  };

  const css =
    mode?.kind === 'native'
      ? fontCss(mode) + deckCss(mode.doc.page)
      : deckCss({ width: 1920, height: 1080 });

  return (
    <div
      className={`app${dragging ? ' app-dragging' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.relatedTarget === null) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <style>{css}</style>
      {mode ? (
        <>
          <TopBar />
          <div className="workspace">
            {mode.kind === 'native' ? (
              <>
                <SlidePanel />
                <NativeCanvas />
                <Properties />
              </>
            ) : (
              <LegacyEditor />
            )}
          </div>
          <StatusBar />
        </>
      ) : (
        <Home />
      )}
      <Dialogs />
      {presenting && <PresentOverlay startAt={presenting.startAt} />}
      {busy && (
        <div className="busy" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          {busy}
        </div>
      )}
      <div className="notices" role="status" aria-live="polite">
        {notices.map((n) => (
          <div key={n.id} className={`notice notice-${n.kind}`}>
            <span>{n.text}</span>
            <button type="button" aria-label="알림 닫기" onClick={() => dismiss(n.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export { saveDocument };
