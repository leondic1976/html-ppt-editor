import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDownToLine,
  ArrowUpToLine,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  StretchHorizontal,
  StretchVertical,
} from 'lucide-react';
import { FONT_CHOICES } from '@hps/design-system';
import {
  alignFrames,
  distributeFrames,
  findLayoutIssues,
  type AlignMode,
  type OverflowIssue,
} from '@hps/interaction';
import {
  plainTextFromDoc,
  type ChartElement,
  type CodeElement,
  type Fill,
  type ImageElement,
  type LineElement,
  type ShapeElement,
  type Slide,
  type SlideElement,
  type TableElement,
  type TextElement,
} from '@hps/document-core';
import { useApp, type NativeState } from '../state/store';
import { insertImageFile, IMAGE_ACCEPT, pickFile } from '../lib/actions';
import { CODE_LANGUAGES } from '../lib/chart-code';
import { prepareUserImage } from '../lib/files';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="prop-row">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Num({
  value,
  onChange,
  step = 1,
  min,
  max,
  testId,
}: {
  value: number;
  onChange(v: number): void;
  step?: number;
  min?: number;
  max?: number;
  testId?: string;
}) {
  const [text, setText] = useState(String(Math.round(value * 100) / 100));
  useEffect(() => setText(String(Math.round(value * 100) / 100)), [value]);
  const commit = (): void => {
    const v = Number(text);
    if (Number.isFinite(v) && v !== value)
      onChange(min !== undefined ? Math.max(min, max !== undefined ? Math.min(max, v) : v) : v);
    else setText(String(Math.round(value * 100) / 100));
  };
  return (
    <input
      className="input"
      type="number"
      data-testid={testId}
      value={text}
      step={step}
      min={min}
      max={max}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

/** Colour input that keeps alpha as a separate value, since the native picker has no alpha. */
function ColorInput({ value, onChange }: { value: string | undefined; onChange(v: string): void }) {
  const base = value && value !== 'transparent' ? value.slice(0, 7) : '#ffffff';
  const hex = base.length === 4 ? `#${[...base.slice(1)].map((c) => c + c).join('')}` : base;
  return (
    <input
      className="color-input"
      type="color"
      value={hex}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function FillEditor({ fill, onChange }: { fill: Fill; onChange(f: Fill): void }) {
  const first =
    fill.type === 'solid'
      ? fill.color
      : fill.type === 'none'
        ? '#2563eb'
        : (fill.stops[0]?.color ?? '#2563eb');
  const last =
    fill.type === 'linear' || fill.type === 'radial'
      ? (fill.stops[fill.stops.length - 1]?.color ?? '#ffffff')
      : '#ffffff';
  const stops = (a: string, b: string) => [
    { offset: 0, color: a },
    { offset: 1, color: b },
  ];
  return (
    <>
      <Row label="채우기">
        <select
          className="select"
          value={fill.type}
          onChange={(e) => {
            const t = e.target.value as Fill['type'];
            if (t === 'none') onChange({ type: 'none' });
            else if (t === 'solid') onChange({ type: 'solid', color: first });
            else if (t === 'linear')
              onChange({ type: 'linear', angle: 135, stops: stops(first, last) });
            else onChange({ type: 'radial', stops: stops(first, last) });
          }}
        >
          <option value="none">없음</option>
          <option value="solid">단색</option>
          <option value="linear">선형 그라데이션</option>
          <option value="radial">방사형 그라데이션</option>
        </select>
      </Row>
      {fill.type === 'solid' && (
        <Row label="색">
          <ColorInput value={fill.color} onChange={(color) => onChange({ type: 'solid', color })} />
        </Row>
      )}
      {(fill.type === 'linear' || fill.type === 'radial') && (
        <>
          <Row label="시작 색">
            <ColorInput
              value={first}
              onChange={(c) => onChange({ ...fill, stops: stops(c, last) })}
            />
          </Row>
          <Row label="끝 색">
            <ColorInput
              value={last}
              onChange={(c) => onChange({ ...fill, stops: stops(first, c) })}
            />
          </Row>
        </>
      )}
      {fill.type === 'linear' && (
        <Row label="각도">
          <Num value={fill.angle} onChange={(angle) => onChange({ ...fill, angle })} />
        </Row>
      )}
    </>
  );
}

function TextProps({ el, update }: { el: TextElement; update(p: Record<string, unknown>): void }) {
  const s = el.style;
  const set = (patch: Partial<TextElement['style']>): void => update({ style: patch });
  return (
    <section className="prop-section">
      <h3>글자</h3>
      <Row label="글꼴">
        <select
          className="select"
          value={s.fontFamily ?? ''}
          onChange={(e) => set({ fontFamily: e.target.value || undefined })}
        >
          <option value="">테마 기본</option>
          {FONT_CHOICES.map((f) => (
            <option key={f.name} value={f.name}>
              {f.name} ({f.note})
            </option>
          ))}
        </select>
      </Row>
      <Row label="크기">
        <Num
          value={s.fontSizePx}
          min={1}
          testId="prop-font-size"
          onChange={(fontSizePx) => set({ fontSizePx })}
        />
      </Row>
      <Row label="색">
        <ColorInput value={s.color} onChange={(color) => set({ color })} />
      </Row>
      <Row label="굵기">
        <select
          className="select"
          value={s.fontWeight}
          onChange={(e) => set({ fontWeight: Number(e.target.value) })}
        >
          {[300, 400, 500, 600, 700, 800, 900].map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </Row>
      <Row label="기울임">
        <input
          type="checkbox"
          checked={s.italic}
          onChange={(e) => set({ italic: e.target.checked })}
        />
      </Row>
      <Row label="가로 정렬">
        <select
          className="select"
          value={s.align}
          onChange={(e) => set({ align: e.target.value as TextElement['style']['align'] })}
        >
          <option value="left">왼쪽</option>
          <option value="center">가운데</option>
          <option value="right">오른쪽</option>
          <option value="justify">양쪽</option>
        </select>
      </Row>
      <Row label="세로 정렬">
        <select
          className="select"
          value={s.valign}
          onChange={(e) => set({ valign: e.target.value as TextElement['style']['valign'] })}
        >
          <option value="top">위</option>
          <option value="middle">가운데</option>
          <option value="bottom">아래</option>
        </select>
      </Row>
      <Row label="줄 간격">
        <Num
          value={s.lineHeight}
          step={0.05}
          min={0.5}
          onChange={(lineHeight) => set({ lineHeight })}
        />
      </Row>
      <Row label="자간">
        <Num
          value={s.letterSpacingPx}
          step={0.5}
          onChange={(letterSpacingPx) => set({ letterSpacingPx })}
        />
      </Row>
      <Row label="문단 간격">
        <Num
          value={s.paragraphSpacingPx}
          min={0}
          onChange={(paragraphSpacingPx) => set({ paragraphSpacingPx })}
        />
      </Row>
      <Row label="안쪽 여백">
        <Num value={s.padding} min={0} onChange={(padding) => set({ padding })} />
      </Row>
      <FillEditor fill={el.fill ?? { type: 'none' }} onChange={(fill) => update({ fill })} />
    </section>
  );
}

function ImageProps({
  el,
  update,
  slideId,
  m,
}: {
  el: ImageElement;
  update(p: Record<string, unknown>): void;
  slideId: string;
  m: NativeState;
}) {
  const app = useApp.getState();
  const replace = async (): Promise<void> => {
    const [file] = await pickFile(IMAGE_ACCEPT);
    if (!file) return;
    try {
      const prepared = await prepareUserImage(new Uint8Array(await file.arrayBuffer()), file);
      if (prepared.meta.kind === 'svg') {
        app.notify('warning', 'SVG는 "삽입" 메뉴로 넣어 주세요.');
        return;
      }
      m.assets.set(prepared.id, prepared.dataUrl);
      app.commit(
        [
          { type: 'asset.add', id: prepared.id, meta: prepared.meta },
          {
            type: 'element.update',
            slideId,
            elementId: el.id,
            patch: {
              assetId: prepared.id,
              naturalWidth: prepared.meta.width,
              naturalHeight: prepared.meta.height,
              crop: undefined,
            },
          },
        ],
        '사진 교체',
      );
    } catch (e) {
      app.notify('error', `사진을 넣지 않았습니다: ${(e as Error).message}`);
    }
  };
  const crop = el.crop;
  return (
    <section className="prop-section">
      <h3>사진</h3>
      <button
        type="button"
        className="btn btn-block"
        data-testid="replace-image"
        onClick={() => void replace()}
      >
        사진 교체…
      </button>
      <Row label="대체 글">
        <input className="input" value={el.alt} onChange={(e) => update({ alt: e.target.value })} />
      </Row>
      <Row label="맞춤">
        <select className="select" value={el.fit} onChange={(e) => update({ fit: e.target.value })}>
          <option value="cover">채우기(잘림)</option>
          <option value="contain">전체 보이기</option>
          <option value="fill">늘이기</option>
        </select>
      </Row>
      <Row label="초점 X">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={el.focal.x}
          onChange={(e) => update({ focal: { x: Number(e.target.value), y: el.focal.y } })}
        />
      </Row>
      <Row label="초점 Y">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={el.focal.y}
          onChange={(e) => update({ focal: { x: el.focal.x, y: Number(e.target.value) } })}
        />
      </Row>
      <Row label="자르기">
        <input
          type="checkbox"
          checked={!!crop}
          onChange={(e) =>
            update({ crop: e.target.checked ? { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } : undefined })
          }
        />
      </Row>
      {crop && (
        <>
          {(['x', 'y', 'w', 'h'] as const).map((k) => (
            <Row key={k} label={`자르기 ${k.toUpperCase()}`}>
              <input
                type="range"
                min={k === 'w' || k === 'h' ? 0.05 : 0}
                max={1}
                step={0.01}
                value={crop[k]}
                onChange={(e) => update({ crop: { ...crop, [k]: Number(e.target.value) } })}
              />
            </Row>
          ))}
        </>
      )}
      <Row label="모서리">
        <Num value={el.radius} min={0} onChange={(radius) => update({ radius })} />
      </Row>
    </section>
  );
}

function ShapeProps({
  el,
  update,
}: {
  el: ShapeElement;
  update(p: Record<string, unknown>): void;
}) {
  const stroke = el.stroke;
  return (
    <section className="prop-section">
      <h3>도형</h3>
      <Row label="모양">
        <select
          className="select"
          value={el.shape}
          onChange={(e) => update({ shape: e.target.value })}
        >
          <option value="rect">사각형</option>
          <option value="roundRect">둥근 사각형</option>
          <option value="ellipse">원</option>
          <option value="triangle">삼각형</option>
          <option value="diamond">마름모</option>
          <option value="chevron">갈매기</option>
          <option value="arrowRight">화살표</option>
        </select>
      </Row>
      {el.shape === 'roundRect' && (
        <Row label="모서리">
          <Num value={el.radius} min={0} onChange={(radius) => update({ radius })} />
        </Row>
      )}
      <FillEditor fill={el.fill} onChange={(fill) => update({ fill })} />
      <Row label="테두리 색">
        <ColorInput
          value={stroke?.color}
          onChange={(color) =>
            update({ stroke: { width: stroke?.width || 4, dash: stroke?.dash ?? 'solid', color } })
          }
        />
      </Row>
      <Row label="테두리 두께">
        <Num
          value={stroke?.width ?? 0}
          min={0}
          onChange={(width) =>
            update({
              stroke:
                width > 0
                  ? { color: stroke?.color ?? '#0f172a', dash: stroke?.dash ?? 'solid', width }
                  : undefined,
            })
          }
        />
      </Row>
      <Row label="테두리 모양">
        <select
          className="select"
          value={stroke?.dash ?? 'solid'}
          disabled={!stroke}
          onChange={(e) => stroke && update({ stroke: { ...stroke, dash: e.target.value } })}
        >
          <option value="solid">실선</option>
          <option value="dashed">파선</option>
          <option value="dotted">점선</option>
        </select>
      </Row>
    </section>
  );
}

function LineProps({ el, update }: { el: LineElement; update(p: Record<string, unknown>): void }) {
  return (
    <section className="prop-section">
      <h3>선</h3>
      <Row label="종류">
        <select
          className="select"
          value={el.kind}
          onChange={(e) => update({ kind: e.target.value })}
        >
          <option value="straight">직선</option>
          <option value="curve">곡선</option>
        </select>
      </Row>
      <Row label="색">
        <ColorInput
          value={el.stroke.color}
          onChange={(color) => update({ stroke: { ...el.stroke, color } })}
        />
      </Row>
      <Row label="두께">
        <Num
          value={el.stroke.width}
          min={1}
          onChange={(width) => update({ stroke: { ...el.stroke, width } })}
        />
      </Row>
      <Row label="모양">
        <select
          className="select"
          value={el.stroke.dash}
          onChange={(e) => update({ stroke: { ...el.stroke, dash: e.target.value } })}
        >
          <option value="solid">실선</option>
          <option value="dashed">파선</option>
          <option value="dotted">점선</option>
        </select>
      </Row>
      <Row label="시작 화살표">
        <input
          type="checkbox"
          checked={el.startArrow}
          onChange={(e) => update({ startArrow: e.target.checked })}
        />
      </Row>
      <Row label="끝 화살표">
        <input
          type="checkbox"
          checked={el.endArrow}
          onChange={(e) => update({ endArrow: e.target.checked })}
        />
      </Row>
    </section>
  );
}

function TableProps({
  el,
  update,
}: {
  el: TableElement;
  update(p: Record<string, unknown>): void;
}) {
  const setCell = (r: number, c: number, text: string): void => {
    update({
      rows: el.rows.map((row, ri) =>
        ri === r ? row.map((cell, ci) => (ci === c ? { ...cell, text } : cell)) : row,
      ),
    });
  };
  const blank = { text: '', bold: false, align: 'left' as const };
  return (
    <section className="prop-section">
      <h3>표</h3>
      <div
        className="table-edit"
        style={{ gridTemplateColumns: `repeat(${el.columns.length}, minmax(0, 1fr))` }}
      >
        {el.rows.map((row, r) =>
          row.map((cell, c) => (
            <input
              key={`${r}-${c}`}
              className="input"
              aria-label={`${r + 1}행 ${c + 1}열`}
              value={cell.text}
              onChange={(e) => setCell(r, c, e.target.value)}
            />
          )),
        )}
      </div>
      <div className="btn-row">
        <button
          type="button"
          className="btn"
          onClick={() => update({ rows: [...el.rows, el.columns.map(() => blank)] })}
        >
          행 추가
        </button>
        <button
          type="button"
          className="btn"
          disabled={el.rows.length < 2}
          onClick={() => update({ rows: el.rows.slice(0, -1) })}
        >
          행 삭제
        </button>
        <button
          type="button"
          className="btn"
          onClick={() =>
            update({ columns: [...el.columns, 1], rows: el.rows.map((r) => [...r, blank]) })
          }
        >
          열 추가
        </button>
        <button
          type="button"
          className="btn"
          disabled={el.columns.length < 2}
          onClick={() =>
            update({ columns: el.columns.slice(0, -1), rows: el.rows.map((r) => r.slice(0, -1)) })
          }
        >
          열 삭제
        </button>
      </div>
      <Row label="글자 크기">
        <Num value={el.fontSizePx} min={1} onChange={(fontSizePx) => update({ fontSizePx })} />
      </Row>
    </section>
  );
}

function ChartProps({
  el,
  update,
}: {
  el: ChartElement;
  update(p: Record<string, unknown>): void;
}) {
  const series = el.series[0]!;
  return (
    <section className="prop-section">
      <h3>차트</h3>
      <Row label="종류">
        <select
          className="select"
          value={el.chartType}
          data-testid="chart-type"
          onChange={(e) => update({ chartType: e.target.value })}
        >
          <option value="bar">막대</option>
          <option value="line">선</option>
          <option value="area">영역</option>
          <option value="pie">원</option>
          <option value="scatter">분산</option>
        </select>
      </Row>
      <Row label="제목">
        <input
          className="input"
          value={el.title ?? ''}
          onChange={(e) => update({ title: e.target.value || undefined })}
        />
      </Row>
      <Row label="범례">
        <input
          type="checkbox"
          checked={el.legend}
          onChange={(e) => update({ legend: e.target.checked })}
        />
      </Row>
      <Row label="단위">
        <input
          className="input"
          value={el.unit ?? ''}
          onChange={(e) => update({ unit: e.target.value || undefined })}
        />
      </Row>
      <Row label="계열 이름">
        <input
          className="input"
          value={series.name}
          onChange={(e) =>
            update({
              series: el.series.map((s, i) => (i === 0 ? { ...s, name: e.target.value } : s)),
            })
          }
        />
      </Row>
      <Row label="색">
        <ColorInput
          value={series.color}
          onChange={(color) =>
            update({ series: el.series.map((s, i) => (i === 0 ? { ...s, color } : s)) })
          }
        />
      </Row>
      <p className="muted">항목과 값(한 줄에 하나: 이름, 값)</p>
      <textarea
        className="input"
        rows={6}
        aria-label="차트 데이터"
        data-testid="chart-data"
        defaultValue={el.categories.map((c, i) => `${c}, ${series.data[i] ?? ''}`).join('\n')}
        onBlur={(e) => {
          const pairs = e.target.value
            .split('\n')
            .map((l) => l.split(',').map((x) => x.trim()))
            .filter((p) => p[0]);
          update({
            categories: pairs.map((p) => p[0]!),
            series: el.series.map((s, i) =>
              i === 0
                ? {
                    ...s,
                    data: pairs.map((p) =>
                      p[1] !== undefined && p[1] !== '' && Number.isFinite(Number(p[1]))
                        ? Number(p[1])
                        : null,
                    ),
                  }
                : s,
            ),
          });
        }}
      />
    </section>
  );
}

function CodeProps({ el, update }: { el: CodeElement; update(p: Record<string, unknown>): void }) {
  return (
    <section className="prop-section">
      <h3>코드</h3>
      <Row label="언어">
        <select
          className="select"
          value={el.language}
          onChange={(e) => update({ language: e.target.value })}
        >
          {CODE_LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </Row>
      <textarea
        className="input code-input"
        rows={8}
        aria-label="코드"
        spellCheck={false}
        value={el.code}
        onChange={(e) => update({ code: e.target.value, tokens: undefined })}
      />
      <Row label="글자 크기">
        <Num value={el.fontSizePx} min={1} onChange={(fontSizePx) => update({ fontSizePx })} />
      </Row>
    </section>
  );
}

function SlideProps({ slide, m }: { slide: Slide; m: NativeState }) {
  const app = useApp.getState();
  const bg = slide.background;
  const setBg = (background: Slide['background']): void => {
    app.commit([{ type: 'slide.update', slideId: slide.id, patch: { background } }], '배경');
  };
  const fill: Fill = bg.type === 'image' ? { type: 'solid', color: '#ffffff' } : bg;
  const pickBg = async (): Promise<void> => {
    const [file] = await pickFile(IMAGE_ACCEPT);
    if (!file) return;
    try {
      const prepared = await prepareUserImage(new Uint8Array(await file.arrayBuffer()), file);
      m.assets.set(prepared.id, prepared.dataUrl);
      app.commit(
        [
          { type: 'asset.add', id: prepared.id, meta: prepared.meta },
          {
            type: 'slide.update',
            slideId: slide.id,
            patch: { background: { type: 'image', assetId: prepared.id, fit: 'cover' } },
          },
        ],
        '배경 이미지',
      );
    } catch (e) {
      app.notify('error', `이미지를 넣지 않았습니다: ${(e as Error).message}`);
    }
  };
  return (
    <>
      <section className="prop-section">
        <h3>슬라이드 {m.slideIndex + 1}</h3>
        {bg.type === 'image' ? (
          <>
            <p className="muted">배경 이미지 사용 중</p>
            <Row label="덮개 색">
              <ColorInput
                value={bg.overlay}
                onChange={(c) => setBg({ ...bg, overlay: `${c}80` })}
              />
            </Row>
            <button
              type="button"
              className="btn btn-block"
              onClick={() => setBg({ type: 'solid', color: '#ffffff' })}
            >
              단색 배경으로
            </button>
          </>
        ) : (
          <FillEditor
            fill={fill}
            onChange={(f) => {
              if (f.type !== 'none') setBg(f);
            }}
          />
        )}
        <button type="button" className="btn btn-block" onClick={() => void pickBg()}>
          배경 이미지…
        </button>
        <Row label="구역 이름">
          <input
            className="input"
            value={slide.section ?? ''}
            onChange={(e) =>
              app.commit(
                [
                  {
                    type: 'slide.update',
                    slideId: slide.id,
                    patch: { section: e.target.value || undefined },
                  },
                ],
                '구역',
                `section:${slide.id}`,
              )
            }
          />
        </Row>
        <Row label="발표에서 숨김">
          <input
            type="checkbox"
            checked={slide.hidden}
            onChange={(e) =>
              app.commit(
                [{ type: 'slide.update', slideId: slide.id, patch: { hidden: e.target.checked } }],
                '슬라이드 숨김',
              )
            }
          />
        </Row>
      </section>
      <section className="prop-section">
        <h3>테마</h3>
        <Row label="기본 글꼴">
          <select
            className="select"
            value={m.doc.theme.fontFamily}
            onChange={(e) =>
              app.commit(
                [{ type: 'theme.update', patch: { fontFamily: e.target.value } }],
                '테마 글꼴',
              )
            }
          >
            {FONT_CHOICES.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
        </Row>
      </section>
    </>
  );
}

function elementLabel(el: SlideElement): string {
  if (el.name) return el.name;
  if (el.type === 'text') return plainTextFromDoc(el.content).slice(0, 24) || '빈 글자';
  const names: Record<SlideElement['type'], string> = {
    text: '글자',
    image: '사진',
    svg: 'SVG',
    shape: '도형',
    line: '선',
    table: '표',
    chart: '차트',
    code: '코드',
  };
  return names[el.type];
}

function Layers({ slide }: { slide: Slide }) {
  const [q, setQ] = useState('');
  const selection = useApp((s) => (s.mode?.kind === 'native' ? s.mode.selection : []));
  const app = useApp.getState();
  const list = [...slide.elements]
    .sort((a, b) => b.zIndex - a.zIndex)
    .filter((e) => !q || elementLabel(e).toLowerCase().includes(q.toLowerCase()));
  return (
    <section className="prop-section">
      <h3>레이어</h3>
      <input
        className="input"
        placeholder="레이어 검색"
        aria-label="레이어 검색"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <ul className="layers">
        {list.map((el) => (
          <li key={el.id} className={selection.includes(el.id) ? 'active' : ''}>
            <button
              type="button"
              className="layer-name"
              data-testid="layer-item"
              onClick={() => app.setSelection([el.id])}
            >
              {elementLabel(el)}
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={el.hidden ? '보이기' : '숨기기'}
              onClick={() =>
                app.commit(
                  [
                    {
                      type: 'element.update',
                      slideId: slide.id,
                      elementId: el.id,
                      patch: { hidden: !el.hidden },
                    },
                  ],
                  '보이기',
                )
              }
            >
              {el.hidden ? (
                <EyeOff size={14} aria-hidden="true" />
              ) : (
                <Eye size={14} aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={el.locked ? '잠금 해제' : '잠금'}
              onClick={() =>
                app.commit(
                  [
                    {
                      type: 'element.update',
                      slideId: slide.id,
                      elementId: el.id,
                      patch: { locked: !el.locked },
                    },
                  ],
                  '잠금',
                )
              }
            >
              {el.locked ? (
                <Lock size={14} aria-hidden="true" />
              ) : (
                <LockOpen size={14} aria-hidden="true" />
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function useLayoutIssues(slide: Slide, page: { width: number; height: number }): OverflowIssue[] {
  const [issues, setIssues] = useState<OverflowIssue[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const heights: Record<string, number> = {};
      for (const el of slide.elements) {
        if (el.type !== 'text') continue;
        const body = document.querySelector<HTMLElement>(
          `.canvas-slide [data-el-id="${CSS.escape(el.id)}"] .hps-text-body`,
        );
        if (body) heights[el.id] = body.scrollHeight + el.style.padding * 2;
      }
      setIssues(
        findLayoutIssues(
          slide.elements.filter((e) => !e.hidden),
          page,
          heights,
        ),
      );
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [slide, page]);
  return issues;
}

export function Properties() {
  const mode = useApp((s) => s.mode);
  const m = mode?.kind === 'native' ? mode : null;
  const slide = m ? m.doc.slides[m.slideIndex]! : null;
  const page = m?.doc.page ?? { width: 1920, height: 1080 };
  const issues = useLayoutIssues(slide ?? ({ elements: [] } as unknown as Slide), page);
  if (!m || !slide) return null;
  const app = useApp.getState();
  const selected = slide.elements.filter((e) => m.selection.includes(e.id));
  const el = selected.length === 1 ? selected[0]! : null;

  const update = (patch: Record<string, unknown>): void => {
    if (el)
      app.commit(
        [{ type: 'element.update', slideId: slide.id, elementId: el.id, patch }],
        '속성 변경',
        `prop:${el.id}`,
      );
  };
  const setFrame = (patch: Partial<SlideElement['frame']>): void => {
    if (el)
      app.commit(
        [{ type: 'element.setFrames', slideId: slide.id, frames: { [el.id]: patch } }],
        '위치/크기',
        `frame:${el.id}`,
      );
  };
  const framesOf = () => Object.fromEntries(selected.map((e) => [e.id, e.frame]));
  const align = (a: AlignMode): void => {
    app.commit(
      [{ type: 'element.setFrames', slideId: slide.id, frames: alignFrames(framesOf(), a, page) }],
      '정렬',
    );
  };
  const distribute = (axis: 'x' | 'y'): void => {
    app.commit(
      [
        {
          type: 'element.setFrames',
          slideId: slide.id,
          frames: distributeFrames(framesOf(), axis),
        },
      ],
      '분배',
    );
  };
  const order = (to: 'front' | 'back' | 'forward' | 'backward'): void => {
    app.commit(
      [{ type: 'element.reorder', slideId: slide.id, elementIds: m.selection, to }],
      '순서',
    );
  };

  return (
    <aside className="properties" aria-label="속성">
      {selected.length > 0 && (
        <section className="prop-section">
          <h3>배치</h3>
          <div className="btn-row" role="toolbar" aria-label="정렬">
            {(
              [
                ['left', '왼쪽 정렬', AlignStartVertical],
                ['hcenter', '가로 가운데', AlignCenterVertical],
                ['right', '오른쪽 정렬', AlignEndVertical],
                ['top', '위쪽 정렬', AlignStartHorizontal],
                ['vcenter', '세로 가운데', AlignCenterHorizontal],
                ['bottom', '아래쪽 정렬', AlignEndHorizontal],
              ] as const
            ).map(([a, label, Icon]) => (
              <button
                key={a}
                type="button"
                className="icon-btn"
                aria-label={label}
                title={label}
                data-testid={`align-${a}`}
                onClick={() => align(a)}
              >
                <Icon size={16} aria-hidden="true" />
              </button>
            ))}
            <button
              type="button"
              className="icon-btn"
              aria-label="가로 분배"
              title="가로 분배"
              disabled={selected.length < 3}
              onClick={() => distribute('x')}
            >
              <StretchHorizontal size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="세로 분배"
              title="세로 분배"
              disabled={selected.length < 3}
              onClick={() => distribute('y')}
            >
              <StretchVertical size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="icon-btn"
              aria-label="맨 앞으로"
              title="맨 앞으로"
              data-testid="to-front"
              onClick={() => order('front')}
            >
              <ArrowUpToLine size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="맨 뒤로"
              title="맨 뒤로"
              data-testid="to-back"
              onClick={() => order('back')}
            >
              <ArrowDownToLine size={16} aria-hidden="true" />
            </button>
            <button type="button" className="btn" onClick={() => order('forward')}>
              앞으로
            </button>
            <button type="button" className="btn" onClick={() => order('backward')}>
              뒤로
            </button>
          </div>
          {el && (
            <div className="prop-grid">
              <Row label="X">
                <Num value={el.frame.x} testId="prop-x" onChange={(x) => setFrame({ x })} />
              </Row>
              <Row label="Y">
                <Num value={el.frame.y} testId="prop-y" onChange={(y) => setFrame({ y })} />
              </Row>
              <Row label="W">
                <Num value={el.frame.w} min={1} testId="prop-w" onChange={(w) => setFrame({ w })} />
              </Row>
              <Row label="H">
                <Num value={el.frame.h} min={1} testId="prop-h" onChange={(h) => setFrame({ h })} />
              </Row>
              <Row label="회전">
                <Num value={el.frame.rotate} onChange={(rotate) => setFrame({ rotate })} />
              </Row>
              <Row label="불투명도">
                <Num
                  value={el.opacity}
                  step={0.05}
                  min={0}
                  max={1}
                  onChange={(opacity) => update({ opacity })}
                />
              </Row>
            </div>
          )}
          {el && (
            <>
              <Row label="그림자">
                <input
                  type="checkbox"
                  checked={!!el.shadow}
                  onChange={(e) =>
                    update({
                      shadow: e.target.checked
                        ? { x: 8, y: 8, blur: 24, color: '#00000066' }
                        : undefined,
                    })
                  }
                />
              </Row>
              {el.shadow && (
                <Row label="흐림">
                  <Num
                    value={el.shadow.blur}
                    min={0}
                    onChange={(blur) => update({ shadow: { ...el.shadow!, blur } })}
                  />
                </Row>
              )}
            </>
          )}
        </section>
      )}
      {el?.type === 'text' && <TextProps el={el} update={update} />}
      {el?.type === 'image' && <ImageProps el={el} update={update} slideId={slide.id} m={m} />}
      {el?.type === 'shape' && <ShapeProps el={el} update={update} />}
      {el?.type === 'line' && <LineProps el={el} update={update} />}
      {el?.type === 'table' && <TableProps el={el} update={update} />}
      {el?.type === 'chart' && <ChartProps el={el} update={update} />}
      {el?.type === 'code' && <CodeProps el={el} update={update} />}
      {selected.length === 0 && <SlideProps slide={slide} m={m} />}
      {issues.length > 0 && (
        <section className="prop-section warn-section" aria-label="배치 경고">
          <h3>배치 경고 {issues.length}</h3>
          <ul className="issue-list">
            {issues.map((issue, i) => {
              const target = slide.elements.find((x) => x.id === issue.elementId);
              return (
                <li key={i}>
                  <button
                    type="button"
                    className="link"
                    onClick={() => app.setSelection([issue.elementId])}
                  >
                    {target ? elementLabel(target) : '요소'}
                  </button>
                  : {issue.message}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <section className="prop-section">
        <h3>발표자 노트</h3>
        <textarea
          className="input"
          rows={4}
          aria-label="발표자 노트"
          data-testid="notes"
          value={slide.notes}
          onChange={(e) =>
            app.commit(
              [{ type: 'slide.update', slideId: slide.id, patch: { notes: e.target.value } }],
              '노트',
              `notes:${slide.id}`,
            )
          }
        />
      </section>
      <Layers slide={slide} />
      <input
        type="file"
        hidden
        accept={IMAGE_ACCEPT}
        data-testid="image-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void insertImageFile(f);
          e.target.value = '';
        }}
      />
    </aside>
  );
}
