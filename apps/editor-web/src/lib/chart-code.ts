import type { ChartElement, CodeElement } from '@hps/document-core';

/**
 * Charts render to static SVG through ECharts' server-side mode, so exported files carry a picture
 * and no chart runtime. Loaded on demand: most decks have no chart.
 */
export async function renderChartSvg(el: ChartElement, fontFamily: string): Promise<string> {
  const echarts = await import('echarts');
  const { w, h } = el.frame;
  const chart = echarts.init(null, null, {
    renderer: 'svg',
    ssr: true,
    width: Math.max(1, w),
    height: Math.max(1, h),
  });
  const size = el.fontSizePx;
  const text = { fontFamily, fontSize: size, color: '#334155' };
  const isPie = el.chartType === 'pie';
  const series = el.series.map((s, i) => {
    if (isPie) {
      return {
        type: 'pie' as const,
        name: s.name,
        radius: '62%',
        data: el.categories.map((name, j) => ({ name, value: s.data[j] ?? 0 })),
        label: { ...text },
        animation: false,
      };
    }
    if (el.chartType === 'scatter') {
      return {
        type: 'scatter' as const,
        name: s.name,
        data: el.categories.map((c, j) => [Number(c) || j + 1, s.data[j] ?? 0]),
        symbolSize: size * 0.7,
        itemStyle: s.color ? { color: s.color } : {},
        animation: false,
      };
    }
    return {
      type: el.chartType === 'area' ? ('line' as const) : el.chartType,
      name: s.name,
      data: s.data,
      ...(el.chartType === 'area' ? { areaStyle: {} } : {}),
      itemStyle: s.color
        ? { color: s.color }
        : { color: ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed'][i % 5] },
      animation: false,
    };
  });
  chart.setOption({
    animation: false,
    textStyle: text,
    ...(el.title
      ? { title: { text: el.title, left: 'center', textStyle: { ...text, fontSize: size * 1.25 } } }
      : {}),
    ...(el.legend ? { legend: { bottom: 0, textStyle: text } } : {}),
    ...(isPie
      ? {}
      : {
          grid: {
            left: size * 3.2,
            right: size,
            top: el.title ? size * 3 : size,
            bottom: el.legend ? size * 3.6 : size * 2,
          },
          xAxis:
            el.chartType === 'scatter'
              ? { type: 'value', name: el.xAxisTitle, axisLabel: text }
              : { type: 'category', data: el.categories, name: el.xAxisTitle, axisLabel: text },
          yAxis: {
            type: 'value',
            name: el.yAxisTitle,
            axisLabel: {
              ...text,
              ...(el.unit ? { formatter: `{value}${el.unit.replace(/[{}]/g, '')}` } : {}),
            },
          },
        }),
    series,
  });
  const svg = chart.renderToSVGString();
  chart.dispose();
  return svg;
}

export const CODE_LANGUAGES = [
  'text',
  'javascript',
  'typescript',
  'python',
  'html',
  'css',
  'json',
  'bash',
  'java',
  'sql',
] as const;

type Highlighter = {
  codeToTokens: (
    code: string,
    opts: { lang: string; theme: string },
  ) => { tokens: { content: string; color?: string }[][] };
};
let highlighter: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ]);
    return (await createHighlighterCore({
      themes: [import('shiki/themes/github-dark.mjs')],
      langs: [
        import('shiki/langs/javascript.mjs'),
        import('shiki/langs/typescript.mjs'),
        import('shiki/langs/python.mjs'),
        import('shiki/langs/html.mjs'),
        import('shiki/langs/css.mjs'),
        import('shiki/langs/json.mjs'),
        import('shiki/langs/bash.mjs'),
        import('shiki/langs/java.mjs'),
        import('shiki/langs/sql.mjs'),
      ],
      // The JS regex engine needs no WebAssembly, which the app's CSP does not allow.
      engine: createJavaScriptRegexEngine(),
    })) as unknown as Highlighter;
  })();
  return highlighter;
}

const HEX = /^#[0-9a-fA-F]{3,8}$/;

/** Structured tokens only: the document never holds highlighter HTML. */
export async function highlightCode(
  el: Pick<CodeElement, 'code' | 'language'>,
): Promise<CodeElement['tokens']> {
  if (el.language === 'text') return undefined;
  try {
    const h = await getHighlighter();
    const { tokens } = h.codeToTokens(el.code, { lang: el.language, theme: 'github-dark' });
    return tokens.map((line) =>
      line.map((t) => ({
        text: t.content,
        ...(t.color && HEX.test(t.color) ? { color: t.color } : {}),
      })),
    );
  } catch {
    return undefined;
  }
}
