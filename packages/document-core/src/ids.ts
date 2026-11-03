import { nanoid } from 'nanoid';

export const newId = (prefix: string): string => `${prefix}-${nanoid(10)}`;

/** Lowercase hex SHA-256 via WebCrypto (browser and Node). Content identity, not a safety signal. */
export async function sha256Hex(data: BufferSource | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function assetIdFor(bytes: BufferSource): Promise<`sha256-${string}`> {
  return `sha256-${await sha256Hex(bytes)}`;
}
