import { defineConfig, mergeConfig } from 'vitest/config';
import base from '../vitest.config.ts';

/** Generators for manual checks. Kept out of the normal test run because they write files. */
export default mergeConfig(
  base,
  defineConfig({
    test: { include: ['scripts/**/*.test.ts'], root: '.' },
  }),
);
