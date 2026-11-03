export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type Category =
  | 'executable'
  | 'test-signature'
  | 'smuggling'
  | 'obfuscation'
  | 'miner'
  | 'system-access'
  | 'exfiltration'
  | 'phishing'
  | 'social-engineering'
  | 'redirect'
  | 'embedding'
  | 'network'
  | 'css'
  | 'resource'
  | 'script';

export interface Finding {
  ruleId: string;
  severity: Severity;
  category: Category;
  title: string;
  detail: string;
  /** 1-based source position, when the finding maps to one place in the file. */
  line?: number;
  column?: number;
  /** Short excerpt with control characters removed. Display as text only. */
  snippet?: string;
  /** Times the rule fired; only the first location is kept. */
  count: number;
}

/**
 * Deliberately has no "safe" value: a static scan can only report what it recognised.
 */
export type Verdict = 'malicious' | 'dangerous' | 'suspicious' | 'caution' | 'none-detected';

export interface ScanStats {
  size: number;
  scripts: number;
  inlineScriptBytes: number;
  externalScripts: number;
  eventHandlers: number;
  iframes: number;
  dataUrls: number;
  externalDomains: string[];
}

export interface ScanReport {
  engine: { name: 'hps-static-scan'; version: string; rules: number };
  fileName: string;
  sha256: string;
  scannedAt: string;
  durationMs: number;
  verdict: Verdict;
  findings: Finding[];
  stats: ScanStats;
  /** What this run did not inspect (truncations, time budget). Empty only when the whole file was read. */
  limits: string[];
}

export interface ScanOptions {
  fileName?: string;
  /** Wall-clock budget. Past this, later stages are skipped and listed in `limits`. */
  timeBudgetMs?: number;
  now?: () => Date;
}

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export const VERDICT_LABEL: Record<Verdict, string> = {
  malicious: '악성 가능성 높음',
  dangerous: '위험',
  suspicious: '의심스러움',
  caution: '주의',
  'none-detected': '알려진 위협 미탐지',
};

/** Must accompany every verdict shown to a user. */
export const SCAN_DISCLAIMER =
  '이 검사는 파일을 실행하지 않는 정적 분석입니다. 백신을 대체하지 않으며, ' +
  '"알려진 위협 미탐지"는 안전하다는 보증이 아닙니다. 새로운 악성코드나 난독화된 코드는 놓칠 수 있습니다.';
