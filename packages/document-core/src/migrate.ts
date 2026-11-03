import { DeckDocument, CURRENT_FORMAT_VERSION } from './schema.js';

type Json = Record<string, unknown>;
interface Migration {
  from: number;
  to: number;
  run(doc: Json): Json;
}

/** v1 (pre-release draft): `style.fontSize`, `slide.bg` colour string, no page.unit. */
const v1ToV2: Migration = {
  from: 1,
  to: 2,
  run(doc) {
    const slides = Array.isArray(doc.slides) ? (doc.slides as Json[]) : [];
    return {
      ...doc,
      formatVersion: 2,
      page: { width: 1920, height: 1080, unit: 'model-px', ratio: '16:9', ...(doc.page as Json) },
      slides: slides.map((s) => {
        const { bg, ...slide } = s;
        return {
          ...slide,
          background: slide.background ?? {
            type: 'solid',
            color: typeof bg === 'string' ? bg : '#ffffff',
          },
          elements: ((slide.elements as Json[]) ?? []).map((el) => {
            const style = el.style as Json | undefined;
            if (!style || !('fontSize' in style)) return el;
            const { fontSize, ...rest } = style;
            return { ...el, style: { ...rest, fontSizePx: fontSize } };
          }),
        };
      }),
    };
  },
};

const MIGRATIONS: Migration[] = [v1ToV2];

export class DocumentValidationError extends Error {
  constructor(
    message: string,
    readonly issues: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'DocumentValidationError';
  }
}

/** Schema-validate any JSON, migrating older formats. Throws DocumentValidationError with field paths. */
export function parseDocument(
  input: unknown,
  now: () => string = () => new Date().toISOString(),
): DeckDocument {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new DocumentValidationError('문서 JSON은 객체여야 합니다.', [
      { path: '', message: 'not an object' },
    ]);
  }
  let doc = input as Json;
  const version = doc.formatVersion;
  if (typeof version !== 'number') {
    throw new DocumentValidationError('formatVersion이 없습니다.', [
      { path: 'formatVersion', message: 'missing' },
    ]);
  }
  if (version > CURRENT_FORMAT_VERSION) {
    throw new DocumentValidationError(
      `이 파일은 더 새로운 형식(v${version})입니다. 앱을 업데이트하세요.`,
      [{ path: 'formatVersion', message: `unsupported: ${version}` }],
    );
  }
  const history: { from: number; to: number; at: string }[] = Array.isArray(doc.migrationHistory)
    ? [...(doc.migrationHistory as { from: number; to: number; at: string }[])]
    : [];
  for (let v = version; v < CURRENT_FORMAT_VERSION;) {
    const step = MIGRATIONS.find((m) => m.from === v);
    if (!step) {
      throw new DocumentValidationError(`v${v} 형식의 마이그레이션 경로가 없습니다.`, [
        { path: 'formatVersion', message: `no migration from ${v}` },
      ]);
    }
    doc = step.run(doc);
    history.push({ from: step.from, to: step.to, at: now() });
    v = step.to;
  }
  doc = { ...doc, migrationHistory: history };

  const result = DeckDocument.safeParse(doc);
  if (!result.success) {
    const issues = result.error.issues.slice(0, 50).map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    throw new DocumentValidationError(
      `문서 검증 실패: ${issues
        .slice(0, 3)
        .map((i) => `${i.path || '(root)'} — ${i.message}`)
        .join('; ')}`,
      issues,
    );
  }
  return result.data;
}

/** Key-sorted JSON, for hashing normalised models (round-trip equality). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      );
    }
    return v;
  });
}

/** Stable form for round-trip comparison: volatile save metadata is dropped. */
export function normalizedForCompare(doc: DeckDocument): string {
  const { lastSavedAt: _s, appVersion: _a, ...rest } = doc;
  return canonicalJson(rest);
}
