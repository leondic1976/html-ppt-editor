import { Minus, Plus } from 'lucide-react';
import { t } from '@hps/design-system';
import { useApp } from '../state/store';

export function StatusBar() {
  useApp((s) => s.locale);
  const mode = useApp((s) => s.mode)!;
  const autosave = useApp((s) => s.autosave);
  const zoom = useApp((s) => s.zoom);
  const app = useApp.getState();
  const isNative = mode.kind === 'native';
  const count = isNative ? mode.doc.slides.length : Math.max(1, mode.session.slides.length);
  const lang = isNative ? mode.doc.meta.locale : mode.session.encoding;
  const selected = isNative ? mode.selection.length : mode.selectedId ? 1 : 0;
  const changes = isNative ? mode.history.past.length : mode.journal.length;

  const setZoom = (delta: number): void => {
    const frame = document.querySelector<HTMLElement>('.stage');
    const width = isNative ? mode.doc.page.width : 1920;
    const cur = zoom ?? (frame ? frame.getBoundingClientRect().width / width : 0.5);
    app.setZoom(Math.max(0.1, Math.min(3, Math.round((cur + delta) * 20) / 20)));
  };

  return (
    <footer className="statusbar">
      <span data-testid="status-page">
        슬라이드 {mode.slideIndex + 1} / {count}
      </span>
      <span>{lang}</span>
      <span data-testid="status-selection">선택 {selected}</span>
      <span data-testid="status-changes">변경 {changes}</span>
      {autosave.status === 'saved' && <span data-testid="autosave">{t('status.autosaved')}</span>}
      {autosave.status === 'error' && <span className="status-error">{autosave.message}</span>}
      {!isNative && <span className="level-tag">L1 원본 보존 편집</span>}
      <span className="spacer" />
      <button type="button" className="icon-btn" aria-label="축소" onClick={() => setZoom(-0.05)}>
        <Minus size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="zoom-label"
        onClick={() => app.setZoom(null)}
        title="화면에 맞춤"
      >
        {zoom ? `${Math.round(zoom * 100)}%` : '맞춤'}
      </button>
      <button type="button" className="icon-btn" aria-label="확대" onClick={() => setZoom(0.05)}>
        <Plus size={14} aria-hidden="true" />
      </button>
    </footer>
  );
}
