import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      [
        'document-core',
        'slide-renderer',
        'interaction',
        'security-scan',
        'import-legacy-html',
        'import-md-json',
        'asset-manager',
        'export-html',
        'export-pptx',
        'export-pdf',
        'export-report',
        'design-system',
      ].map((n) => [`@hps/${n}`, pkg(n)]),
    ),
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**'],
      reporter: ['text-summary', 'lcov'],
    },
  },
});
