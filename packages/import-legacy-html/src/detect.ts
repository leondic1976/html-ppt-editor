import {
  attrOf,
  classesOf,
  collectText,
  elementChildren,
  type AstNode,
  type LegacyIndex,
} from './ast.js';

export interface SlideCandidate {
  /** Human-readable description of what matched. */
  rule: string;
  ids: string[];
  /** 0..1. */
  confidence: number;
}

export interface SlideDetection {
  status: 'detected' | 'single-page' | 'failed';
  slides: string[];
  confidence: number;
  rule: string | null;
  candidates: SlideCandidate[];
  /** Why detection may be wrong or incomplete, in user language. */
  notes: string[];
  scriptRendered: boolean;
}

type Matcher = {
  rule: string;
  confidence: number;
  test: (node: AstNode, parent: AstNode | null) => boolean;
};

const hasClass = (node: AstNode, cls: string): boolean => classesOf(node).includes(cls);
const tagOf = (node: AstNode): string => node.tagName?.toLowerCase() ?? '';

const MATCHERS: Matcher[] = [
  { rule: '[data-slide]', confidence: 0.98, test: (n) => attrOf(n, 'data-slide') !== undefined },
  {
    rule: '[data-slide-id]',
    confidence: 0.98,
    test: (n) => attrOf(n, 'data-slide-id') !== undefined,
  },
  { rule: '[data-page]', confidence: 0.85, test: (n) => attrOf(n, 'data-page') !== undefined },
  {
    rule: '.reveal .slides > section',
    confidence: 0.97,
    test: (n, p) => tagOf(n) === 'section' && !!p && hasClass(p, 'slides'),
  },
  {
    rule: 'section.slide',
    confidence: 0.96,
    test: (n) => tagOf(n) === 'section' && hasClass(n, 'slide'),
  },
  { rule: '.slide', confidence: 0.93, test: (n) => hasClass(n, 'slide') },
  { rule: '.swiper-slide', confidence: 0.9, test: (n) => hasClass(n, 'swiper-slide') },
  { rule: '.remark-slide', confidence: 0.9, test: (n) => hasClass(n, 'remark-slide') },
  {
    rule: '.ppt-slide',
    confidence: 0.92,
    test: (n) => hasClass(n, 'ppt-slide') || hasClass(n, 'pptx-slide'),
  },
  { rule: '.page', confidence: 0.72, test: (n) => hasClass(n, 'page') },
  {
    rule: 'article.slide-like',
    confidence: 0.6,
    test: (n) => tagOf(n) === 'article' && /slide|page/i.test(attrOf(n, 'class') ?? ''),
  },
];

/** Direct `<body>` children that are all sections: a very common AI-generated structure. */
function bodySections(index: LegacyIndex): SlideCandidate | null {
  for (const [id, entry] of index.byId) {
    if (entry.node !== index.body) continue;
    const kids = elementChildren(entry.node);
    const sections = kids.map((k, i) => ({ k, i })).filter(({ k }) => tagOf(k) === 'section');
    if (
      sections.length >= 2 &&
      sections.length >= kids.filter((k) => tagOf(k) !== 'script').length * 0.6
    ) {
      return {
        rule: 'body > section',
        ids: sections.map(({ i }) => `${id}/${i}`),
        confidence: 0.82,
      };
    }
  }
  return null;
}

/** Repeating siblings with a slide-like class, such as `.deck > .frame`. */
function repeatedSiblings(index: LegacyIndex): SlideCandidate | null {
  let best: SlideCandidate | null = null;
  for (const [id, entry] of index.byId) {
    const kids = elementChildren(entry.node);
    if (kids.length < 3) continue;
    const groups = new Map<string, number[]>();
    kids.forEach((k, i) => {
      const cls = classesOf(k)[0];
      if (!cls || !/slide|page|frame|card|screen|deck-item/i.test(cls)) return;
      const key = `${tagOf(k)}.${cls}`;
      groups.set(key, [...(groups.get(key) ?? []), i]);
    });
    for (const [key, idx] of groups) {
      if (
        idx.length >= 3 &&
        idx.length >= kids.length * 0.7 &&
        (!best || idx.length > best.ids.length)
      ) {
        best = { rule: `반복 구조 ${key}`, ids: idx.map((i) => `${id}/${i}`), confidence: 0.62 };
      }
    }
  }
  return best;
}

/** Slide elements nested inside other matches are parts of a slide, not slides. */
function outermost(ids: string[]): string[] {
  const set = new Set(ids);
  return ids.filter((id) => {
    let i = id.lastIndexOf('/');
    while (i > 0) {
      if (set.has(id.slice(0, i))) return false;
      i = id.lastIndexOf('/', i - 1);
    }
    return true;
  });
}

function compareIds(a: string, b: string): number {
  const pa = a.split('/').map(Number);
  const pb = b.split('/').map(Number);
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  }
  return pa.length - pb.length;
}

export function detectSlides(index: LegacyIndex): SlideDetection {
  const candidates: SlideCandidate[] = [];
  for (const m of MATCHERS) {
    const ids: string[] = [];
    for (const [id, entry] of index.byId) {
      const parent = entry.parentId ? (index.byId.get(entry.parentId)?.node ?? null) : null;
      if (m.test(entry.node, parent)) ids.push(id);
    }
    const top = outermost(ids).sort(compareIds);
    if (top.length) candidates.push({ rule: m.rule, ids: top, confidence: m.confidence });
  }
  const sections = bodySections(index);
  if (sections) candidates.push(sections);
  const siblings = repeatedSiblings(index);
  if (siblings) candidates.push(siblings);

  const bodyText = index.body ? collectText(index.body).trim() : '';
  const bodyElements = index.body ? elementChildren(index.body) : [];
  const scriptTexts = bodyElements
    .filter((n) => tagOf(n) === 'script')
    .map(collectText)
    .join('');
  const headScripts = index.head
    ? elementChildren(index.head)
        .filter((n) => tagOf(n) === 'script')
        .map(collectText)
        .join('')
    : '';
  const allScripts = scriptTexts + headScripts;
  const visibleText = bodyText.length - scriptTexts.length;
  const scriptRendered =
    allScripts.length > 200 &&
    visibleText < 200 &&
    /createElement|innerHTML|insertAdjacentHTML|\.render\(|slides\s*[:=]\s*\[/.test(allScripts);

  const notes: string[] = [];
  if (scriptRendered) {
    notes.push(
      '슬라이드 내용을 스크립트가 만드는 파일로 보입니다. 이 에디터는 파일의 스크립트를 실행하지 않으므로 내용이 비어 보일 수 있습니다. 브라우저 개발자 도구에서 렌더링된 HTML을 저장해 열면 편집할 수 있습니다.',
    );
  }

  // Prefer the most trustworthy rule that yields more than one slide.
  const ranked = [...candidates].sort(
    (a, b) => b.confidence - a.confidence || b.ids.length - a.ids.length,
  );
  const multi = ranked.find((c) => c.ids.length >= 2);
  if (multi) {
    if (multi.confidence < 0.8) {
      notes.push(
        `확신도가 낮은 규칙(${multi.rule})으로 찾았습니다. 슬라이드 구분이 맞는지 확인하세요.`,
      );
    }
    return {
      status: 'detected',
      slides: multi.ids,
      confidence: multi.confidence,
      rule: multi.rule,
      candidates: ranked,
      notes,
      scriptRendered,
    };
  }
  const single = ranked[0];
  if (single && single.ids.length === 1) {
    return {
      status: 'single-page',
      slides: single.ids,
      confidence: single.confidence * 0.7,
      rule: single.rule,
      candidates: ranked,
      notes,
      scriptRendered,
    };
  }
  // Never split an unknown document into invented pages (plan §3).
  notes.push(
    '슬라이드 구분을 찾지 못했습니다. 웹 페이지일 수 있습니다. 전체를 한 장으로 열거나, 슬라이드에 해당하는 요소를 직접 지정하세요.',
  );
  return {
    status: 'failed',
    slides: [],
    confidence: 0,
    rule: null,
    candidates: ranked,
    notes,
    scriptRendered,
  };
}
