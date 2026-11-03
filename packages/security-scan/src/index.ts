export * from './types.js';
export * from './decode.js';
export * from './shrink.js';
export { sniffImage, sniffMagic, decodeBase64, DANGEROUS_EXTENSIONS } from './sniff.js';
export type { ImageKind, MagicHit } from './sniff.js';
export { scanHtmlFile, scanImageFile, normalizeScript, ENGINE_VERSION } from './scan.js';
export type { AssetScanResult } from './scan.js';

/** Link for a user-initiated reputation lookup. Only the hash leaves the machine, and only if clicked. */
export const virusTotalUrl = (sha256: string): string =>
  `https://www.virustotal.com/gui/file/${encodeURIComponent(sha256)}`;
