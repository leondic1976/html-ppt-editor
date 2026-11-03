import { useEffect, useMemo, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ExternalLink, ShieldAlert } from 'lucide-react';
import { FONT_CHOICES, t } from '@hps/design-system';
import { formatReport } from '@hps/export-report';
import {
  idsForSelector,
  PREVIEW_SANDBOX,
  buildPreview,
  purifyPreview,
  setSlides,
} from '@hps/import-legacy-html';
import {
  SCAN_DISCLAIMER,
  VERDICT_LABEL,
  virusTotalUrl,
  type ScanReport,
  type Severity,
} from '@hps/security-scan';
import { assetIdFor } from '@hps/document-core';
import { bytesToDataUrl, downloadBytes, type StoredSnapshot } from '@hps/asset-manager';
import { useApp, localStore } from '../state/store';
import { blocksOpening, needsDecision, openScanned, validatedSnapshot } from '../lib/files';
import { pickFile, saveLegacy } from '../lib/actions';
import { createFromTemplate, TEMPLATES } from '../lib/templates';

function Shell({
  title,
  children,
  onClose,
  wide,
  testId,
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
  wide?: boolean;
  testId?: string;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className={`dialog${wide ? ' dialog-wide' : ''}`}
          data-testid={testId}
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            // Land on the safe choice. Otherwise focus goes to whatever control comes first in the body.
            const safe = (e.currentTarget as HTMLElement).querySelector<HTMLElement>(
              '[data-autofocus]',
            );
            if (safe) {
              e.preventDefault();
              safe.focus();
            }
          }}
        >
          <Dialog.Title className="dialog-title">{title}</Dialog.Title>
          <div className="dialog-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: '심각',
  high: '높음',
  medium: '중간',
  low: '낮음',
  info: '정보',
};

function ScanDialog({
  report,
  bytes,
  decide,
}: {
  report: ScanReport;
  bytes: Uint8Array;
  decide?: boolean;
}) {
  const app = useApp.getState();
  const close = (): void => app.setDialog(null);
  const blocked = blocksOpening(report);
  const risky = needsDecision(report);
  const size = report.stats.size;
  const exportJson = (): void => {
    const body = new TextEncoder().encode(JSON.stringify(report, null, 2));
    downloadBytes(body, `${report.fileName}.scan.json`, 'application/json');
  };
  return (
    <Shell title="보안 검사 결과" onClose={close} wide testId="scan-dialog">
      <div
        className={`verdict verdict-${report.verdict}`}
        data-testid="scan-verdict"
        data-verdict={report.verdict}
      >
        <ShieldAlert size={22} aria-hidden="true" />
        <div>
          <strong>{VERDICT_LABEL[report.verdict]}</strong>
          <div className="verdict-file">{report.fileName}</div>
        </div>
      </div>
      <p className="disclaimer" data-testid="scan-disclaimer">
        {SCAN_DISCLAIMER}
      </p>
      {report.findings.length > 0 ? (
        <ul className="finding-list" data-testid="scan-findings">
          {report.findings.map((f) => (
            <li key={f.ruleId} className={`finding finding-${f.severity}`} data-rule={f.ruleId}>
              <div className="finding-head">
                <span className={`sev sev-${f.severity}`}>{SEVERITY_LABEL[f.severity]}</span>
                <strong>{f.title}</strong>
                {f.count > 1 && <span className="muted">{f.count}건</span>}
              </div>
              <p>{f.detail}</p>
              {(f.line || f.snippet) && (
                <p className="finding-loc">
                  {f.line ? `${f.line}행 ` : ''}
                  {f.snippet && <code>{f.snippet}</code>}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>규칙에 걸린 항목이 없습니다.</p>
      )}
      <dl className="scan-facts">
        <div>
          <dt>크기</dt>
          <dd>
            {size > 1024 * 1024
              ? `${(size / 1024 / 1024).toFixed(1)}MB`
              : `${Math.ceil(size / 1024)}KB`}
          </dd>
        </div>
        <div>
          <dt>스크립트</dt>
          <dd>
            {report.stats.scripts}개 (외부 {report.stats.externalScripts}개)
          </dd>
        </div>
        <div>
          <dt>이벤트 처리기</dt>
          <dd>{report.stats.eventHandlers}개</dd>
        </div>
        <div>
          <dt>iframe</dt>
          <dd>{report.stats.iframes}개</dd>
        </div>
        <div>
          <dt>검사 시간</dt>
          <dd>{report.durationMs}ms</dd>
        </div>
      </dl>
      {report.stats.externalDomains.length > 0 && (
        <details>
          <summary>접속 대상 도메인 {report.stats.externalDomains.length}개</summary>
          <ul className="domain-list">
            {report.stats.externalDomains.map((d) => (
              <li key={d}>
                <code>{d}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
      {report.limits.length > 0 && (
        <div className="limits" data-testid="scan-limits">
          <strong>검사하지 못한 부분</strong>
          <ul>
            {report.limits.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="hash">
        SHA-256 <code data-testid="scan-sha256">{report.sha256}</code>
      </p>
      <div className="btn-row dialog-actions">
        <a
          className="btn"
          href={virusTotalUrl(report.sha256)}
          target="_blank"
          rel="noopener noreferrer"
          title="파일은 보내지 않고 해시값으로만 조회합니다"
        >
          VirusTotal에서 해시 조회 <ExternalLink size={14} aria-hidden="true" />
        </a>
        <button type="button" className="btn" onClick={exportJson}>
          결과 저장(JSON)
        </button>
        <span className="spacer" />
        {decide && !blocked && risky && (
          <button
            type="button"
            className="btn btn-danger"
            data-testid="scan-open-anyway"
            onClick={() => {
              close();
              void openScanned(bytes, report.fileName, report);
            }}
          >
            위험을 알고 격리 상태로 열기
          </button>
        )}
        <Dialog.Close asChild>
          <button type="button" className="btn btn-primary" data-testid="scan-close" data-autofocus>
            {decide ? '열지 않기' : t('common.close')}
          </button>
        </Dialog.Close>
      </div>
      {decide && blocked && <p className="muted">이 파일은 HTML이 아니므로 열 수 없습니다.</p>}
      {decide && !blocked && risky && (
        <p className="muted">
          격리 상태로 열어도 파일의 스크립트는 실행되지 않고 외부 접속도 차단됩니다. 단, 저장한
          파일에는 원본 코드가 그대로 남으니 브라우저에서 직접 열지 마세요.
        </p>
      )}
    </Shell>
  );
}

function ImportReportDialog() {
  const mode = useApp((s) => s.mode);
  const app = useApp.getState();
  if (mode?.kind !== 'legacy') return null;
  const r = mode.session.report;
  return (
    <Shell title="가져오기 보고서" onClose={() => app.setDialog(null)} wide testId="import-report">
      <dl className="scan-facts">
        <div>
          <dt>파일</dt>
          <dd>{r.fileName}</dd>
        </div>
        <div>
          <dt>인코딩</dt>
          <dd>{r.encoding}</dd>
        </div>
        <div>
          <dt>슬라이드</dt>
          <dd data-testid="report-slides">
            {mode.session.slides.length}장 ({r.detection.rule ?? '구분 없음'}, 확신도{' '}
            {Math.round(r.detection.confidence * 100)}%)
          </dd>
        </div>
        <div>
          <dt>고칠 수 있는 글자</dt>
          <dd>{r.editableTexts}곳</dd>
        </div>
        <div>
          <dt>고칠 수 있는 사진</dt>
          <dd>{r.editableImages}곳</dd>
        </div>
        <div>
          <dt>실행 안 한 스크립트</dt>
          <dd>{r.removed.scripts}개</dd>
        </div>
      </dl>
      {r.warnings.length > 0 && (
        <>
          <h3>경고</h3>
          <ul className="issue-list">
            {r.warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </>
      )}
      {r.externalResources.length > 0 && (
        <details>
          <summary>차단된 외부 리소스 {r.externalResources.length}개</summary>
          <ul className="domain-list">
            {r.externalResources.map((u) => (
              <li key={u}>
                <code>{u.slice(0, 120)}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
      {r.missingLocalAssets.length > 0 && (
        <details>
          <summary>파일 밖 리소스 {r.missingLocalAssets.length}개</summary>
          <ul className="domain-list">
            {r.missingLocalAssets.map((u) => (
              <li key={u}>
                <code>{u.slice(0, 120)}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
      {r.fontsReferenced.length > 0 && (
        <p>
          <strong>사용 글꼴:</strong> {r.fontsReferenced.join(', ')}
        </p>
      )}
      <div className="btn-row dialog-actions">
        <Dialog.Close asChild>
          <button type="button" className="btn btn-primary">
            {t('common.close')}
          </button>
        </Dialog.Close>
      </div>
    </Shell>
  );
}

function SlidesSelectorDialog() {
  const mode = useApp((s) => s.mode);
  const app = useApp.getState();
  const [selector, setSelector] = useState('section');
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewHtml = useMemo(
    () =>
      mode?.kind === 'legacy'
        ? purifyPreview(
            buildPreview(mode.session.source, { localAssets: mode.localAssets }).html,
            window,
          )
        : '',
    [mode],
  );
  if (mode?.kind !== 'legacy') return null;

  const query = (cb: (ids: string[]) => void): void => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', PREVIEW_SANDBOX);
    frame.style.cssText = 'position:fixed;left:-100000px;width:1920px;height:1080px';
    frame.srcdoc = previewHtml;
    frame.onload = () => {
      try {
        cb(idsForSelector(frame.contentDocument!, selector));
        setError(null);
      } catch {
        setError('올바른 CSS 선택자가 아닙니다.');
      }
      frame.remove();
    };
    document.body.appendChild(frame);
  };

  return (
    <Shell title="슬라이드 구분 지정" onClose={() => app.setDialog(null)} testId="selector-dialog">
      <p>
        슬라이드 한 장에 해당하는 요소의 CSS 선택자를 입력하세요. 예: <code>section</code>,{' '}
        <code>.page</code>, <code>main &gt; div</code>
      </p>
      <label className="prop-row">
        <span>선택자</span>
        <input
          className="input"
          data-testid="selector-input"
          value={selector}
          onChange={(e) => setSelector(e.target.value)}
        />
      </label>
      {count !== null && <p data-testid="selector-count">{count}개 요소를 찾았습니다.</p>}
      {error && <p className="status-error">{error}</p>}
      <div className="btn-row dialog-actions">
        <button
          type="button"
          className="btn"
          data-testid="selector-test"
          onClick={() => query((ids) => setCount(ids.length))}
        >
          찾아보기
        </button>
        <button
          type="button"
          className="btn"
          data-testid="selector-whole"
          onClick={() => {
            app.patchLegacy({
              session: setSlides(mode.session, []),
              slideIndex: 0,
              frameVersion: mode.frameVersion + 1,
            });
            app.setDialog(null);
          }}
        >
          전체를 한 장으로
        </button>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="selector-apply"
          onClick={() =>
            query((ids) => {
              if (!ids.length) {
                setError('찾은 요소가 없습니다.');
                return;
              }
              app.patchLegacy({
                session: setSlides(mode.session, ids),
                slideIndex: 0,
                frameVersion: mode.frameVersion + 1,
              });
              app.setDialog(null);
            })
          }
        >
          적용
        </button>
      </div>
    </Shell>
  );
}

function HistoryDialog() {
  const mode = useApp((s) => s.mode);
  const app = useApp.getState();
  const [items, setItems] = useState<StoredSnapshot[] | null>(null);
  const docId = mode?.kind === 'native' ? mode.doc.docId : null;
  useEffect(() => {
    if (docId) {
      localStore
        .history(docId)
        .then(setItems)
        .catch(() => setItems([]));
    }
  }, [docId]);
  return (
    <Shell title="버전 기록" onClose={() => app.setDialog(null)} testId="history-dialog">
      <p className="muted">
        이 브라우저에 임시로 보관됩니다(문서당 최근 20개). 브라우저 데이터를 지우면 사라집니다.
      </p>
      {items === null ? (
        <p>불러오는 중…</p>
      ) : items.length === 0 ? (
        <p>저장된 기록이 없습니다.</p>
      ) : (
        <ul className="history-list">
          {items.map((s) => (
            <li key={s.key}>
              <span>
                {new Date(s.savedAt).toLocaleString()}{' '}
                <span className="muted">{s.reason === 'manual' ? '수동 저장' : '자동 저장'}</span>
              </span>
              <button
                type="button"
                className="link"
                onClick={async () => {
                  const doc = validatedSnapshot(s.doc);
                  const assets = await localStore.loadAssets(doc);
                  app.openNative(doc, assets);
                  useApp.setState({ dirty: true });
                  app.notify('success', '이 시점으로 되돌렸습니다. 파일로 저장해야 반영됩니다.');
                  app.setDialog(null);
                }}
              >
                이 버전으로 되돌리기
              </button>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

function fontStatus(name: string): string {
  try {
    return document.fonts.check(`16px "${name}"`) ? '사용 가능' : '이 PC에 없음';
  } catch {
    return '확인 불가';
  }
}

function FontsDialog() {
  const mode = useApp((s) => s.mode);
  const app = useApp.getState();
  if (mode?.kind !== 'native') return null;
  const used = new Set<string>([mode.doc.theme.fontFamily]);
  for (const s of mode.doc.slides)
    for (const e of s.elements)
      if (e.type === 'text' && e.style.fontFamily) used.add(e.style.fontFamily);
  const embedded = Object.entries(mode.doc.assets).filter(([, m]) => m.kind === 'font');
  const addFont = async (): Promise<void> => {
    const [file] = await pickFile('.woff2,.woff,.ttf,.otf');
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4));
    const ok =
      head === 'wOF2' ||
      head === 'wOFF' ||
      head === 'OTTO' ||
      (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0);
    if (!ok) {
      app.notify('error', '글꼴 파일이 아닙니다.');
      return;
    }
    if (
      !window.confirm(
        '이 글꼴을 파일에 포함하면 파일과 함께 재배포됩니다. OFL 등 재배포가 허용된 글꼴인가요?',
      )
    )
      return;
    const id = await assetIdFor(bytes as BufferSource);
    const mime =
      head === 'wOF2'
        ? 'font/woff2'
        : head === 'wOFF'
          ? 'font/woff'
          : head === 'OTTO'
            ? 'font/otf'
            : 'font/ttf';
    mode.assets.set(id, bytesToDataUrl(bytes, mime));
    app.commit(
      [
        {
          type: 'asset.add',
          id,
          meta: {
            kind: 'font',
            mime,
            size: bytes.length,
            source: 'embedded',
            name: file.name.replace(/\.\w+$/, ''),
            license: '사용자 확인',
          },
        },
      ],
      '글꼴 추가',
    );
  };
  return (
    <Shell title="글꼴 관리" onClose={() => app.setDialog(null)} testId="fonts-dialog">
      <h3>이 문서가 쓰는 글꼴</h3>
      <ul className="font-list">
        {[...used].map((name) => {
          const choice = FONT_CHOICES.find((f) => f.name === name);
          return (
            <li key={name}>
              <strong>{name}</strong> <span className="muted">{choice?.note ?? '사용자 지정'}</span>{' '}
              <span>{fontStatus(name)}</span>
            </li>
          );
        })}
      </ul>
      <p className="muted">
        설치되지 않은 글꼴은 대체 글꼴로 표시되어 줄바꿈이 달라질 수 있습니다. PPTX는 글꼴을
        포함하지 않으므로 받는 PC에도 설치되어 있어야 합니다.
      </p>
      <h3>파일에 포함한 글꼴 {embedded.length}</h3>
      <ul className="font-list">
        {embedded.map(([id, m]) => (
          <li key={id}>
            {m.name} <span className="muted">{Math.ceil(m.size / 1024)}KB</span>
          </li>
        ))}
      </ul>
      <button type="button" className="btn" onClick={() => void addFont()}>
        글꼴 파일 포함…
      </button>
    </Shell>
  );
}

function TemplatesDialog() {
  const app = useApp.getState();
  return (
    <Shell title="템플릿으로 시작" onClose={() => app.setDialog(null)} testId="templates-dialog">
      <div className="template-grid">
        {TEMPLATES.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            className="template-card"
            data-testid={`template-${tpl.id}`}
            onClick={() => {
              app.openNative(createFromTemplate(tpl), new Map());
              app.setDialog(null);
            }}
          >
            <span
              className="template-swatch"
              style={{
                background:
                  tpl.background.type === 'solid'
                    ? tpl.background.color
                    : tpl.background.type === 'linear'
                      ? `linear-gradient(135deg, ${tpl.background.stops[0]!.color}, ${tpl.background.stops[1]!.color})`
                      : '#fff',
                color: tpl.foreground,
              }}
            >
              <b style={{ color: tpl.accent }}>가</b> Aa
            </span>
            <strong>{tpl.name}</strong>
            <span className="muted">{tpl.description}</span>
          </button>
        ))}
      </div>
    </Shell>
  );
}

export function Dialogs() {
  const dialog = useApp((s) => s.dialog);
  const app = useApp.getState();
  if (!dialog) return null;
  const close = (): void => app.setDialog(null);
  switch (dialog.type) {
    case 'scan':
      return (
        <ScanDialog
          report={dialog.report}
          bytes={dialog.bytes}
          {...(dialog.decide ? { decide: true } : {})}
        />
      );
    case 'import-report':
      return <ImportReportDialog />;
    case 'slides-selector':
      return <SlidesSelectorDialog />;
    case 'history':
      return <HistoryDialog />;
    case 'fonts':
      return <FontsDialog />;
    case 'templates':
      return <TemplatesDialog />;
    case 'export-report':
      return (
        <Shell title="PPTX 변환 보고서" onClose={close} wide testId="export-report">
          <pre className="report-text" data-testid="export-report-text">
            {formatReport(dialog.report)}
          </pre>
          <p className="muted">
            PowerPoint·Keynote·Google Slides마다 표시가 조금씩 다를 수 있습니다. 결과가 깨지면 외관
            우선으로 다시 내보내세요.
          </p>
          <div className="btn-row dialog-actions">
            <Dialog.Close asChild>
              <button type="button" className="btn btn-primary">
                {t('common.close')}
              </button>
            </Dialog.Close>
          </div>
        </Shell>
      );
    case 'conversion':
      return (
        <Shell title={dialog.title} onClose={close} wide testId="conversion-report">
          <ul className="issue-list">
            {dialog.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          <div className="btn-row dialog-actions">
            <Dialog.Close asChild>
              <button type="button" className="btn btn-primary">
                {t('common.close')}
              </button>
            </Dialog.Close>
          </div>
        </Shell>
      );
    case 'confirm-overwrite':
      return (
        <Shell title="같은 파일에 저장할까요?" onClose={close} testId="confirm-overwrite">
          <p>
            <strong>{dialog.name}</strong> 파일을 덮어씁니다. 변경 {dialog.changes}건이 반영됩니다.
          </p>
          <div className="btn-row dialog-actions">
            <button type="button" className="btn" onClick={close}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                close();
                void saveLegacy(true);
              }}
            >
              다른 이름으로
            </button>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="confirm-overwrite-yes"
              onClick={() => {
                close();
                void saveLegacy(false);
              }}
            >
              덮어쓰기
            </button>
          </div>
        </Shell>
      );
  }
}
