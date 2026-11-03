/** Shared import/export loss report: every downgrade names its slide and object (plan §7). */
export type LossSeverity = 'info' | 'warning' | 'error';

export interface ReportItem {
  slide: number;
  elementId?: string;
  severity: LossSeverity;
  code: string;
  message: string;
}

export interface ExportCounts {
  slides: number;
  elements: number;
  native: number;
  svg: number;
  imageFallback: number;
  lost: number;
}

export interface ExportReport {
  format: 'pptx' | 'pdf' | 'html';
  mode: string;
  generatedAt: string;
  counts: ExportCounts;
  fontsUsed: string[];
  items: ReportItem[];
}

export const emptyCounts = (): ExportCounts => ({
  slides: 0,
  elements: 0,
  native: 0,
  svg: 0,
  imageFallback: 0,
  lost: 0,
});

const MODE_LABEL: Record<string, string> = {
  editable: '편집 우선',
  fidelity: '외관 우선',
};

export function formatReport(r: ExportReport): string {
  const lines = [
    `문서: ${r.counts.slides}장 / ${r.counts.elements}개 요소`,
    `모드: ${MODE_LABEL[r.mode] ?? r.mode}`,
    `네이티브 편집 요소: ${r.counts.native}개`,
    `SVG 삽입: ${r.counts.svg}개`,
    `이미지 폴백: ${r.counts.imageFallback}개`,
    `손실/치환 경고: ${r.items.filter((i) => i.severity !== 'info').length}개`,
  ];
  for (const item of r.items) {
    const where = item.slide > 0 ? `${item.slide}장: ` : '';
    const id = item.elementId ? ` [${item.elementId}]` : '';
    lines.push(`  - ${where}${item.message}${id}`);
  }
  if (r.fontsUsed.length) lines.push(`사용 글꼴(받는 PC에 설치 필요): ${r.fontsUsed.join(', ')}`);
  return lines.join('\n');
}
