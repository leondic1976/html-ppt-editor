import type { Severity } from './types.js';

export interface MagicHit {
  kind: string;
  severity: Severity;
  label: string;
}

const eq = (b: Uint8Array, sig: number[], at = 0): boolean => sig.every((v, i) => b[at + i] === v);

/** Identify binary payloads by their leading bytes. Never trusts extension or declared MIME. */
export function sniffMagic(b: Uint8Array): MagicHit | null {
  if (b.length < 2) return null;
  if (eq(b, [0x4d, 0x5a])) {
    // "MZ" alone is two common letters; require a PE header or a plausible DOS stub.
    const peOffset = b.length >= 64 ? b[60]! | (b[61]! << 8) | (b[62]! << 16) | (b[63]! << 24) : -1;
    const isPe = peOffset > 0 && peOffset + 4 <= b.length && eq(b, [0x50, 0x45, 0, 0], peOffset);
    const hasStub = new TextDecoder('latin1')
      .decode(b.subarray(0, Math.min(b.length, 512)))
      .includes('This program cannot be run');
    if (isPe || hasStub)
      return { kind: 'pe', severity: 'critical', label: 'Windows 실행 파일(PE/EXE/DLL)' };
  }
  if (eq(b, [0x7f, 0x45, 0x4c, 0x46]))
    return { kind: 'elf', severity: 'critical', label: 'Linux 실행 파일(ELF)' };
  if (
    eq(b, [0xfe, 0xed, 0xfa, 0xce]) ||
    eq(b, [0xfe, 0xed, 0xfa, 0xcf]) ||
    eq(b, [0xcf, 0xfa, 0xed, 0xfe]) ||
    eq(b, [0xce, 0xfa, 0xed, 0xfe])
  ) {
    return { kind: 'macho', severity: 'critical', label: 'macOS 실행 파일(Mach-O)' };
  }
  if (eq(b, [0xca, 0xfe, 0xba, 0xbe]))
    return { kind: 'java', severity: 'high', label: 'Java 클래스 또는 범용 바이너리' };
  if (eq(b, [0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00])) {
    return { kind: 'lnk', severity: 'critical', label: 'Windows 바로가기(.lnk)' };
  }
  if (eq(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return {
      kind: 'ole',
      severity: 'high',
      label: 'OLE 복합 문서(MSI 또는 매크로 Office 파일 가능)',
    };
  }
  if (eq(b, [0x50, 0x4b, 0x03, 0x04]) || eq(b, [0x50, 0x4b, 0x05, 0x06])) {
    return { kind: 'zip', severity: 'high', label: 'ZIP 압축 파일(JAR/APK/Office 포함)' };
  }
  if (eq(b, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]))
    return { kind: 'rar', severity: 'high', label: 'RAR 압축 파일' };
  if (eq(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))
    return { kind: '7z', severity: 'high', label: '7z 압축 파일' };
  if (eq(b, [0x1f, 0x8b])) return { kind: 'gzip', severity: 'medium', label: 'GZIP 압축 데이터' };
  if (eq(b, [0x43, 0x44, 0x30, 0x30, 0x31], 0x8001))
    return { kind: 'iso', severity: 'high', label: 'ISO 디스크 이미지' };
  if (eq(b, [0x25, 0x50, 0x44, 0x46, 0x2d]))
    return { kind: 'pdf', severity: 'medium', label: 'PDF 문서' };
  if (eq(b, [0x00, 0x61, 0x73, 0x6d]))
    return { kind: 'wasm', severity: 'medium', label: 'WebAssembly 모듈' };
  return null;
}

export type ImageKind = 'png' | 'jpeg' | 'gif' | 'webp' | 'avif' | 'bmp' | 'svg';

export function sniffImage(b: Uint8Array): ImageKind | null {
  if (eq(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (eq(b, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (eq(b, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (eq(b, [0x52, 0x49, 0x46, 0x46]) && eq(b, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  if (eq(b, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = new TextDecoder('latin1').decode(b.subarray(8, 12));
    if (brand === 'avif' || brand === 'avis') return 'avif';
  }
  if (eq(b, [0x42, 0x4d])) return 'bmp';
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, 1024));
  return startsLikeSvg(head) ? 'svg' : null;
}

/**
 * Prolog, comments and doctype, then `<svg`. Hand-written because this reads untrusted bytes on the
 * main thread: the equivalent regex backtracks exponentially on repeated `--><!--`, so a file of a
 * few hundred bytes could hang the tab. This is one forward pass.
 */
function startsLikeSvg(head: string): boolean {
  const s = head.toLowerCase();
  let i = 0;
  const skipSpace = (): void => {
    while (i < s.length && /\s/.test(s[i]!)) i++;
  };
  /** Moves past the next occurrence of `end`; false when there is none. */
  const skipPast = (end: string, from: number): boolean => {
    const at = s.indexOf(end, from);
    if (at < 0) return false;
    i = at + end.length;
    return true;
  };
  skipSpace();
  if (s.startsWith('<?xml', i)) {
    if (!skipPast('>', i)) return false;
    skipSpace();
  }
  while (s.startsWith('<!--', i)) {
    if (!skipPast('-->', i + 4)) return false;
    skipSpace();
  }
  if (s.startsWith('<!doctype svg', i)) {
    if (!skipPast('>', i)) return false;
    skipSpace();
  }
  return s.startsWith('<svg', i) && i + 4 < s.length && /[\s>]/.test(s[i + 4]!);
}

export const DANGEROUS_EXTENSIONS =
  /\.(exe|scr|com|pif|bat|cmd|msi|msp|ps1|psm1|vbs|vbe|wsf|wsh|hta|cpl|jar|lnk|iso|img|vhd|reg|dll|sys|apk|dmg|pkg|sh|appimage|xll|docm|xlsm|pptm|one)$/i;

/** ASCII-only strict base64 decode (no atob dependency). Stops at `maxBytes`. */
export function decodeBase64(input: string, maxBytes: number): Uint8Array | null {
  const clean = input.replace(/[\s]/g, '');
  if (clean.length < 4) return null;
  const table = BASE64_TABLE;
  const outLen = Math.min(Math.floor((clean.length * 3) / 4), maxBytes);
  const out = new Uint8Array(outLen);
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < clean.length && o < outLen; i++) {
    const c = clean.charCodeAt(i);
    if (c === 61) break;
    const v = table[c];
    if (v === undefined || v === 255) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
      acc &= (1 << bits) - 1;
    }
  }
  return out.subarray(0, o);
}

const BASE64_TABLE: Uint8Array = (() => {
  const t = new Uint8Array(256).fill(255);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < chars.length; i++) t[chars.charCodeAt(i)] = i;
  t['-'.charCodeAt(0)] = 62;
  t['_'.charCodeAt(0)] = 63;
  return t;
})();

/** Shannon entropy in bits per character; used only as a supporting obfuscation signal. */
export function entropy(s: string): number {
  if (!s) return 0;
  const counts = new Map<number, number>();
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}
