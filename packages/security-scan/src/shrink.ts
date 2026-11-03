/**
 * Long unbroken base64-alphabet runs (embedded pictures, mostly) dominate parse time because an HTML
 * tokenizer reads them one character at a time, yet no parser decision depends on their contents.
 * Parsing a copy with those runs swapped for short tokens makes a 50MB deck behave like a small one.
 * `expand` restores the exact text, so byte preservation is unaffected.
 */
export interface ShrunkText {
  text: string;
  blobs: string[];
  /** Restores every token in a string derived from `text`. */
  expand(derived: string): string;
}

const MIN_RUN = 64 * 1024;

const isBase64Char = (c: number): boolean =>
  (c >= 65 && c <= 90) ||
  (c >= 97 && c <= 122) ||
  (c >= 48 && c <= 57) ||
  c === 43 ||
  c === 47 ||
  c === 61;

/** A hand-written scan: a regex here would retry from every position and go quadratic on near-misses. */
export function shrinkBlobs(source: string): ShrunkText {
  const runs: [number, number][] = [];
  let start = -1;
  const n = source.length;
  for (let i = 0; i <= n; i++) {
    if (i < n && isBase64Char(source.charCodeAt(i))) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start >= MIN_RUN) runs.push([start, i]);
      start = -1;
    }
  }
  if (!runs.length) return { text: source, blobs: [], expand: (s) => s };

  // Deterministic, so anchors computed on this text match after save and reopen.
  let prefix = 'HPSBLOB';
  while (source.includes(`${prefix}_`)) prefix += 'X';

  const blobs: string[] = [];
  const parts: string[] = [];
  let cursor = 0;
  for (const [a, b] of runs) {
    parts.push(source.slice(cursor, a), `${prefix}_${blobs.length}_`);
    blobs.push(source.slice(a, b));
    cursor = b;
  }
  parts.push(source.slice(cursor));
  const token = new RegExp(`${prefix}_(\\d+)_`, 'g');
  return {
    text: parts.join(''),
    blobs,
    expand: (derived) =>
      derived.replace(token, (whole, idx: string) => blobs[Number(idx)] ?? whole),
  };
}
