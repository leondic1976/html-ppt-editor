// Enforces the package boundary rules from plan §10. Fails CI when a package imports what it must not.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RULES = {
  'document-core': { forbid: [/^react/, /^@hps\//, /^@tiptap/], noDom: true },
  'slide-renderer': {
    forbid: [/^react/, /^@tiptap/, /^zustand/],
    allowHps: ['document-core'],
    noDom: true,
  },
  interaction: { forbid: [/^react/, /^@hps\//], noDom: true },
  'security-scan': { forbid: [/^react/, /^@hps\//], noDom: true },
  'export-pptx': {
    forbid: [/^react/, /^zustand/, /editor-web/],
    allowHps: ['document-core', 'export-report'],
    noDom: true,
  },
  'export-report': { forbid: [/^react/, /^@hps\//], noDom: true },
  'export-html': {
    forbid: [/^react/, /^zustand/],
    allowHps: ['document-core', 'slide-renderer'],
    noDom: true,
  },
  'import-legacy-html': {
    forbid: [/^react/, /^zustand/],
    allowHps: ['document-core', 'security-scan'],
  },
  'import-md-json': { forbid: [/^react/], allowHps: ['document-core'], noDom: true },
};

// Globals that would tie a package to a browser page. convert/stage/purify in legacy are DOM by design.
const DOM_USE = /\b(?:document|window|localStorage|navigator)\.[a-zA-Z]/;

const IMPORT =
  /^\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm;
const files = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
  });

const problems = [];
for (const [pkg, rule] of Object.entries(RULES)) {
  for (const file of files(join('packages', pkg, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(IMPORT)) {
      const spec = m[1] ?? m[2];
      const hps = /^@hps\/(.+)$/.exec(spec)?.[1];
      if (hps && rule.allowHps?.includes(hps)) continue;
      if (rule.forbid.some((re) => re.test(spec)))
        problems.push(`${file}: must not import ${spec}`);
    }
    // rules.ts holds patterns describing other people's code, and runtime.ts is text embedded in exports.
    if (rule.noDom && !/[\\/](?:rules|runtime)\.ts$/.test(file)) {
      const code = text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      const hit = DOM_USE.exec(code);
      if (hit) problems.push(`${file}: DOM use "${hit[0]}" in a DOM-free package`);
    }
  }
}

// plan §3: nothing outside the sandbox policy may grant script to imported content.
for (const file of [...files('packages/import-legacy-html/src'), ...files('apps/editor-web/src')]) {
  const text = readFileSync(file, 'utf8');
  if (/sandbox[^\n]*allow-scripts/.test(text.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, ''))) {
    problems.push(`${file}: grants allow-scripts to a frame`);
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('package boundaries OK');
