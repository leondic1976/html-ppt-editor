// Fails on copyleft or unknown licences in production dependencies (plan §14), and writes an SBOM-style list.
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const OK =
  /^(?:\(?(?:MIT|ISC|BSD-[23]-Clause|Apache-2\.0|0BSD|Zlib|Unlicense|CC0-1\.0|BlueOak-1\.0\.0|Python-2\.0|OFL-1\.1)\)?(?:\s+(?:OR|AND)\s+)?)+$/;
// jszip is offered under "MIT OR GPL-3.0"; this project takes it under MIT.
const CHOSEN = {
  '(MIT OR GPL-3.0-or-later)': 'MIT',
  'MIT OR GPL-3.0': 'MIT',
  '(MPL-2.0 OR Apache-2.0)': 'Apache-2.0',
};

const raw = execSync('pnpm licenses list --prod --json', {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const byLicense = JSON.parse(raw);
const rows = [];
const bad = [];
for (const [license, pkgs] of Object.entries(byLicense)) {
  const effective = CHOSEN[license] ?? license;
  for (const p of pkgs) {
    rows.push({ name: p.name, versions: p.versions ?? [p.version], license, used: effective });
    if (!OK.test(effective)) bad.push(`${p.name}: ${license}`);
  }
}
mkdirSync('artifacts', { recursive: true });
writeFileSync(
  'artifacts/sbom.json',
  JSON.stringify(
    rows.sort((a, b) => a.name.localeCompare(b.name)),
    null,
    2,
  ),
);
console.log(`${rows.length} production packages (artifacts/sbom.json)`);
if (bad.length) {
  console.error(`허용되지 않은 라이선스:\n${bad.join('\n')}`);
  process.exit(1);
}
