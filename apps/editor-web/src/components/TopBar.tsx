import type { ReactNode } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Redo2, Save, ShieldAlert, ShieldCheck, Undo2 } from 'lucide-react';
import { t, type StringKey } from '@hps/design-system';
import { VERDICT_LABEL } from '@hps/security-scan';
import { useApp } from '../state/store';
import {
  exportHtml,
  exportJson,
  exportPptx,
  exportZip,
  insertElement,
  insertImageFile,
  IMAGE_ACCEPT,
  legacyToNative,
  pickFile,
  printDeck,
  saveDocument,
} from '../lib/actions';
import { openFiles } from '../lib/files';
import { openPresenterWindow } from './Present';
import { deleteSelection, duplicateSelection } from './shortcuts';

function DropMenu({
  label,
  children,
  testId,
}: {
  label: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger className="menu-trigger" data-testid={testId}>
        {label}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="menu" align="start" sideOffset={4}>
          {children}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Item({
  onSelect,
  children,
  shortcut,
  disabled,
  testId,
}: {
  onSelect: () => void;
  children: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <Menu.Item className="menu-item" disabled={disabled} data-testid={testId} onSelect={onSelect}>
      <span>{children}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </Menu.Item>
  );
}

export function TopBar() {
  useApp((s) => s.locale);
  const mode = useApp((s) => s.mode)!;
  const dirty = useApp((s) => s.dirty);
  const lastScan = useApp((s) => s.lastScan);
  const dark = useApp((s) => s.dark);
  const locale = useApp((s) => s.locale);
  const showSafe = useApp((s) => s.showSafeArea);
  const showGrid = useApp((s) => s.showGrid);
  const app = useApp.getState();
  const isNative = mode.kind === 'native';
  const label = (k: StringKey): string => t(k);

  const canUndo = isNative ? mode.history.past.length > 0 : mode.undo.length > 0;
  const canRedo = isNative ? mode.history.future.length > 0 : mode.redo.length > 0;
  const worrying = lastScan && lastScan.verdict !== 'none-detected';

  return (
    <header className="topbar">
      <div className="topbar-title">
        <span className="brand">{label('app.name')}</span>
        {isNative ? (
          <input
            className="title-input"
            aria-label="문서 제목"
            value={mode.doc.meta.title}
            onChange={(e) =>
              app.commit(
                [{ type: 'meta.update', patch: { title: e.target.value } }],
                '제목',
                'title',
              )
            }
          />
        ) : (
          <span className="file-name" title={mode.session.fileName}>
            {mode.session.fileName}
          </span>
        )}
        <span className={`save-state${dirty ? ' save-dirty' : ''}`} data-testid="save-state">
          {dirty ? label('status.unsaved') : label('status.saved')}
        </span>
      </div>

      <nav className="menus" aria-label="메인 메뉴">
        <DropMenu label={label('menu.file')} testId="menu-file">
          <Item
            onSelect={() =>
              void pickFile('.html,.htm,.json,.md,.markdown,.zip,image/*', true).then((f) => {
                if (f.length) void openFiles(f);
              })
            }
          >
            {label('file.open')}
          </Item>
          <Item shortcut="Ctrl+S" testId="file-save" onSelect={() => void saveDocument()}>
            {label('file.save')}
          </Item>
          <Item
            shortcut="Ctrl+Shift+S"
            testId="file-save-as"
            onSelect={() => void saveDocument(true)}
          >
            {label('file.saveAs')}
          </Item>
          {isNative && <Item onSelect={() => void exportZip()}>{label('file.saveZip')}</Item>}
          <Menu.Separator className="menu-sep" />
          {isNative && (
            <Item onSelect={() => app.setDialog({ type: 'history' })}>{label('file.history')}</Item>
          )}
          {isNative && (
            <Item onSelect={() => app.setDialog({ type: 'fonts' })}>{label('file.fonts')}</Item>
          )}
          {!isNative && (
            <Item
              testId="file-import-report"
              onSelect={() => app.setDialog({ type: 'import-report' })}
            >
              {label('file.import')}
            </Item>
          )}
          {lastScan && (
            <Item
              testId="file-security"
              onSelect={() =>
                app.setDialog({ type: 'scan', report: lastScan, bytes: new Uint8Array() })
              }
            >
              {label('file.security')}
            </Item>
          )}
          <Menu.Separator className="menu-sep" />
          <Item
            testId="file-close"
            onSelect={() => {
              if (
                !useApp.getState().dirty ||
                window.confirm('저장하지 않은 변경 사항이 있습니다. 닫을까요?')
              )
                app.closeDocument();
            }}
          >
            {label('file.close')}
          </Item>
        </DropMenu>

        <DropMenu label={label('menu.edit')}>
          <Item shortcut="Ctrl+Z" disabled={!canUndo} onSelect={() => app.undo()}>
            {label('edit.undo')}
          </Item>
          <Item shortcut="Ctrl+Y" disabled={!canRedo} onSelect={() => app.redo()}>
            {label('edit.redo')}
          </Item>
          {isNative && (
            <>
              <Menu.Separator className="menu-sep" />
              <Item
                shortcut="Ctrl+D"
                disabled={!mode.selection.length}
                onSelect={duplicateSelection}
              >
                {label('edit.duplicate')}
              </Item>
              <Item shortcut="Del" disabled={!mode.selection.length} onSelect={deleteSelection}>
                {label('edit.delete')}
              </Item>
              <Item
                shortcut="Ctrl+G"
                disabled={mode.selection.length < 2}
                onSelect={() =>
                  app.commit(
                    [
                      {
                        type: 'element.group',
                        slideId: mode.doc.slides[mode.slideIndex]!.id,
                        elementIds: mode.selection,
                      },
                    ],
                    '그룹',
                  )
                }
              >
                {label('edit.group')}
              </Item>
              <Item
                shortcut="Ctrl+Shift+G"
                disabled={!mode.selection.length}
                onSelect={() =>
                  app.commit(
                    [
                      {
                        type: 'element.ungroup',
                        slideId: mode.doc.slides[mode.slideIndex]!.id,
                        elementIds: mode.selection,
                      },
                    ],
                    '그룹 해제',
                  )
                }
              >
                {label('edit.ungroup')}
              </Item>
            </>
          )}
          {!isNative && (
            <>
              <Menu.Separator className="menu-sep" />
              <Item
                testId="legacy-selector"
                onSelect={() => app.setDialog({ type: 'slides-selector' })}
              >
                {label('legacy.slides')}
              </Item>
              <Item testId="legacy-l2" onSelect={() => void legacyToNative('L2')}>
                {label('legacy.convertL2')}
              </Item>
              <Item testId="legacy-l3" onSelect={() => void legacyToNative('L3')}>
                {label('legacy.convertL3')}
              </Item>
            </>
          )}
        </DropMenu>

        {isNative && (
          <DropMenu label={label('menu.insert')} testId="menu-insert">
            <Item testId="insert-text" onSelect={() => insertElement('text')}>
              {label('insert.text')}
            </Item>
            <Item
              testId="insert-image"
              onSelect={() =>
                void pickFile(IMAGE_ACCEPT).then((f) => f[0] && insertImageFile(f[0]))
              }
            >
              {label('insert.image')}
            </Item>
            <Menu.Separator className="menu-sep" />
            <Item testId="insert-rect" onSelect={() => insertElement('rect')}>
              {label('insert.shape')}: 사각형
            </Item>
            <Item onSelect={() => insertElement('roundRect')}>
              {label('insert.shape')}: 둥근 사각형
            </Item>
            <Item onSelect={() => insertElement('ellipse')}>{label('insert.shape')}: 원</Item>
            <Item onSelect={() => insertElement('triangle')}>{label('insert.shape')}: 삼각형</Item>
            <Item onSelect={() => insertElement('diamond')}>{label('insert.shape')}: 마름모</Item>
            <Item onSelect={() => insertElement('arrowRight')}>
              {label('insert.shape')}: 화살표
            </Item>
            <Item testId="insert-line" onSelect={() => insertElement('line')}>
              {label('insert.line')}
            </Item>
            <Menu.Separator className="menu-sep" />
            <Item testId="insert-table" onSelect={() => insertElement('table')}>
              {label('insert.table')}
            </Item>
            <Item testId="insert-chart" onSelect={() => insertElement('chart')}>
              {label('insert.chart')}
            </Item>
            <Item testId="insert-code" onSelect={() => insertElement('code')}>
              {label('insert.code')}
            </Item>
          </DropMenu>
        )}

        <DropMenu label={label('menu.view')} testId="menu-view">
          <Item onSelect={() => app.setZoom(null)}>{label('view.fit')}</Item>
          {isNative && (
            <Item
              onSelect={() => app.toggle('showSafeArea')}
            >{`${showSafe ? '✓ ' : ''}${label('view.safe')}`}</Item>
          )}
          {isNative && (
            <Item
              onSelect={() => app.toggle('showGrid')}
            >{`${showGrid ? '✓ ' : ''}${label('view.grid')}`}</Item>
          )}
          {!isNative && (
            <Item
              testId="view-compare"
              onSelect={() => app.patchLegacy({ compare: !mode.compare })}
            >
              {`${mode.compare ? '✓ ' : ''}${label('view.compare')}`}
            </Item>
          )}
          {!isNative && (
            <Item
              testId="allow-external"
              onSelect={() =>
                app.patchLegacy({
                  allowExternal: !mode.allowExternal,
                  frameVersion: mode.frameVersion + 1,
                })
              }
            >
              {`${mode.allowExternal ? '✓ ' : ''}${label('legacy.allowExternal')}`}
            </Item>
          )}
          <Menu.Separator className="menu-sep" />
          <Item onSelect={() => app.setDark(!dark)}>{label('view.theme')}</Item>
          <Item onSelect={() => app.setLanguage(locale === 'ko' ? 'en' : 'ko')}>
            {label('view.language')}
          </Item>
        </DropMenu>

        <DropMenu label={label('menu.present')} testId="menu-present">
          <Item
            shortcut="F5"
            testId="present-start"
            onSelect={() => app.setPresenting({ startAt: 0 })}
          >
            {label('present.start')}
          </Item>
          <Item
            shortcut="Shift+F5"
            onSelect={() => app.setPresenting({ startAt: mode.slideIndex })}
          >
            {label('present.current')}
          </Item>
          {isNative && (
            <Item testId="presenter-view" onSelect={openPresenterWindow}>
              {label('present.presenter')}
            </Item>
          )}
        </DropMenu>

        <DropMenu label={label('menu.export')} testId="menu-export">
          {isNative ? (
            <>
              <Item testId="export-html" onSelect={() => void exportHtml('editable')}>
                {label('export.html')}
              </Item>
              <Item testId="export-present" onSelect={() => void exportHtml('present')}>
                {label('export.htmlPresent')}
              </Item>
            </>
          ) : (
            <Item testId="export-html" onSelect={() => void saveDocument(true)}>
              {label('export.html')}
            </Item>
          )}
          <Item testId="export-print" onSelect={() => void printDeck()}>
            {label('export.print')}
          </Item>
          <Menu.Separator className="menu-sep" />
          <Item testId="export-pptx-edit" onSelect={() => void exportPptx('editable')}>
            {label('export.pptxEdit')}
          </Item>
          <Item testId="export-pptx-look" onSelect={() => void exportPptx('fidelity')}>
            {label('export.pptxLook')}
          </Item>
          {isNative && (
            <>
              <Menu.Separator className="menu-sep" />
              <Item onSelect={() => void exportJson()}>{label('export.json')}</Item>
            </>
          )}
        </DropMenu>
      </nav>

      <div className="topbar-actions">
        {lastScan && (
          <button
            type="button"
            className={`scan-badge scan-${lastScan.verdict}`}
            data-testid="scan-badge"
            title="보안 검사 결과 보기"
            onClick={() =>
              app.setDialog({ type: 'scan', report: lastScan, bytes: new Uint8Array() })
            }
          >
            {worrying ? (
              <ShieldAlert size={16} aria-hidden="true" />
            ) : (
              <ShieldCheck size={16} aria-hidden="true" />
            )}
            {VERDICT_LABEL[lastScan.verdict]}
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          aria-label={label('edit.undo')}
          disabled={!canUndo}
          data-testid="undo"
          onClick={() => app.undo()}
        >
          <Undo2 size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={label('edit.redo')}
          disabled={!canRedo}
          data-testid="redo"
          onClick={() => app.redo()}
        >
          <Redo2 size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="save"
          onClick={() => void saveDocument()}
        >
          <Save size={16} aria-hidden="true" /> {label('file.save')}
        </button>
      </div>
    </header>
  );
}
