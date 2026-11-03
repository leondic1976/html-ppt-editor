import createDOMPurify from 'dompurify';
import { shrinkBlobs } from '@hps/security-scan';

/**
 * Second sanitising layer (browser or jsdom). Independent of the AST pass, so a bug in one layer
 * does not by itself open the editor to script. Takes a Window so tests can pass jsdom's.
 */
export function purifyPreview(html: string, win: Window & typeof globalThis): string {
  const purify = createDOMPurify(win);
  // Large base64 runs are opaque to the sanitiser's decisions, and only slow it down.
  const shrunk = shrinkBlobs(html);
  const clean = purify.sanitize(shrunk.text, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['link', 'style', 'meta', 'title', 'head', 'html', 'body', 'foreignObject'],
    ADD_ATTR: [
      'http-equiv',
      'content',
      'charset',
      'rel',
      'data-hps-id',
      'data-hps-preview',
      'data-hps-blocked-src',
      'target',
    ],
    ALLOW_DATA_ATTR: true,
    ALLOW_ARIA_ATTR: true,
    FORBID_TAGS: [
      'script',
      'iframe',
      'object',
      'embed',
      'base',
      'frame',
      'frameset',
      'applet',
      'portal',
    ],
    FORBID_ATTR: ['srcdoc', 'formaction', 'ping'],
    // Preview data URLs for images and fonts survive this; the frame's CSP constrains the rest.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
    RETURN_DOM: false,
  }) as string;
  const restored = shrunk.expand(clean);
  return /^\s*<!doctype/i.test(html) && !/^\s*<!doctype/i.test(restored)
    ? `<!doctype html>${restored}`
    : restored;
}
