export * from './schema.js';
export * from './units.js';
export * from './ids.js';
export * from './text.js';
export * from './migrate.js';
export * from './factory.js';
export * from './commands.js';

const LS = new RegExp(String.fromCharCode(0x2028), 'g');
const PS = new RegExp(String.fromCharCode(0x2029), 'g');

/** JSON safe inside <script type="application/json">: nothing can close or reopen the tag (plan §5, §16). */
export const jsonForScriptTag = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(LS, '\\u2028')
    .replace(PS, '\\u2029');
