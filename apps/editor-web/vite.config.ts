import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = (name: string): string =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

const PACKAGES = [
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
];

/**
 * App-page CSP, production only (Vite's dev client needs inline script). No connect-src beyond
 * 'self': the app has no way to send a user's file anywhere. https: images/fonts exist solely for
 * the opt-in "allow external" preview, whose frame also has its own stricter policy.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  'media-src data: blob:',
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "frame-src 'self' about: blob:",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

const cspPlugin = (): Plugin => ({
  name: 'hps-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
      injectTo: 'head-prepend',
    },
  ],
});

export default defineConfig({
  // Relative so the build works from any path, including GitHub Pages project sites.
  base: './',
  plugins: [react(), cspPlugin()],
  resolve: {
    alias: Object.fromEntries(PACKAGES.map((n) => [`@hps/${n}`, pkg(n)])),
  },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 2000 },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
