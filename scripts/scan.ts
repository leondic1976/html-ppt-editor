/**
 * Command-line scan, for CI or for checking a file before opening it anywhere.
 * Usage: pnpm scan <file> [--json]
 * Exit code: 0 none detected or caution, 1 suspicious, 2 dangerous or malicious, 3 usage/IO error.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { SCAN_DISCLAIMER, scanHtmlFile, VERDICT_LABEL } from '@hps/security-scan';

const args = process.argv.slice(2);
const json = args.includes('--json');
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('사용법: pnpm scan <파일> [--json]');
  process.exit(3);
}

let bytes: Uint8Array;
try {
  bytes = new Uint8Array(readFileSync(file));
} catch (e) {
  console.error(`파일을 읽을 수 없습니다: ${(e as Error).message}`);
  process.exit(3);
}

const report = await scanHtmlFile(bytes, { fileName: basename(file) });
if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`${report.fileName}: ${VERDICT_LABEL[report.verdict]}`);
  console.log(`SHA-256 ${report.sha256}`);
  for (const f of report.findings) {
    const where = f.line ? ` (${f.line}행)` : '';
    console.log(`  [${f.severity}] ${f.title}${where}${f.count > 1 ? ` ×${f.count}` : ''}`);
  }
  for (const l of report.limits) console.log(`  검사 제한: ${l}`);
  console.log(`\n${SCAN_DISCLAIMER}`);
}
process.exit(
  report.verdict === 'malicious' || report.verdict === 'dangerous'
    ? 2
    : report.verdict === 'suspicious'
      ? 1
      : 0,
);
