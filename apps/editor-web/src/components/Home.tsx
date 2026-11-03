import { useEffect, useState } from 'react';
import { FilePlus2, FolderOpen, LayoutTemplate, ShieldCheck, Trash2 } from 'lucide-react';
import { t } from '@hps/design-system';
import type { StoredLegacy, StoredSnapshot } from '@hps/asset-manager';
import { useApp, localStore } from '../state/store';
import { openFiles, validatedSnapshot } from '../lib/files';
import { pickFile } from '../lib/actions';
import { createFromTemplate, TEMPLATES } from '../lib/templates';

const OPEN_ACCEPT = '.html,.htm,.json,.md,.markdown,.zip,image/*';

export function Home() {
  useApp((s) => s.locale);
  const openNative = useApp((s) => s.openNative);
  const notify = useApp((s) => s.notify);
  const setDialog = useApp((s) => s.setDialog);
  const [snapshots, setSnapshots] = useState<StoredSnapshot[]>([]);
  const [legacyCopies, setLegacyCopies] = useState<StoredLegacy[]>([]);

  const reload = (): void => {
    localStore
      .latestSnapshots()
      .then(setSnapshots)
      .catch(() => setSnapshots([]));
    localStore
      .listLegacy()
      .then(setLegacyCopies)
      .catch(() => setLegacyCopies([]));
  };
  useEffect(reload, []);

  const open = async (): Promise<void> => {
    const files = await pickFile(OPEN_ACCEPT, true);
    if (files.length) await openFiles(files);
  };

  const recover = async (s: StoredSnapshot): Promise<void> => {
    try {
      const doc = validatedSnapshot(s.doc);
      const assets = await localStore.loadAssets(doc);
      openNative(doc, assets);
      notify('success', `${new Date(s.savedAt).toLocaleString()} 시점으로 복구했습니다.`);
    } catch {
      notify('error', '이 기록을 복구할 수 없습니다.');
    }
  };

  return (
    <main className="home">
      <header className="home-head">
        <h1>{t('app.name')}</h1>
        <p>{t('home.tagline')}</p>
      </header>
      <button type="button" className="dropzone" data-testid="dropzone" onClick={() => void open()}>
        <FolderOpen size={40} aria-hidden="true" />
        <strong>{t('home.drop')}</strong>
        <span>{t('home.dropHint')}</span>
      </button>
      <div className="home-actions">
        <button
          type="button"
          className="btn"
          data-testid="new-doc"
          onClick={() => openNative(createFromTemplate(TEMPLATES[0]!, '제목 없음'), new Map())}
        >
          <FilePlus2 size={18} aria-hidden="true" /> {t('home.new')}
        </button>
        <button type="button" className="btn" onClick={() => setDialog({ type: 'templates' })}>
          <LayoutTemplate size={18} aria-hidden="true" /> {t('home.templates')}
        </button>
        <button
          type="button"
          className="btn"
          data-testid="scan-only"
          onClick={() => {
            void pickFile('*/*').then((files) => {
              if (files.length) void openFiles(files, { scanOnly: true });
            });
          }}
        >
          <ShieldCheck size={18} aria-hidden="true" /> {t('home.scanOnly')}
        </button>
      </div>
      {snapshots.length + legacyCopies.length > 0 && (
        <section className="recover" aria-label={t('home.recover')}>
          <h2>{t('home.recover')}</h2>
          <p className="muted">
            이 브라우저에 임시로 남아 있는 기록입니다. 브라우저 데이터를 지우면 사라지므로 중요한
            작업은 파일로 저장하세요.
          </p>
          <ul>
            {legacyCopies.map((c) => (
              <li key={c.key}>
                <button
                  type="button"
                  className="link"
                  data-testid="recover-legacy"
                  onClick={() =>
                    void openFiles([
                      new File([c.bytes as BlobPart], c.fileName, { type: 'text/html' }),
                    ])
                  }
                >
                  {c.fileName} (수정 {c.changes}건)
                </button>
                <span className="muted">{new Date(c.savedAt).toLocaleString()}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`${c.fileName} 기록 삭제`}
                  onClick={() => void localStore.deleteLegacy(c.key).then(reload)}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
            {snapshots.slice(0, 6).map((s) => (
              <li key={s.key}>
                <button type="button" className="link" onClick={() => void recover(s)}>
                  {s.title}
                </button>
                <span className="muted">{new Date(s.savedAt).toLocaleString()}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`${s.title} 기록 삭제`}
                  onClick={() => void localStore.deleteDoc(s.docId).then(reload)}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
