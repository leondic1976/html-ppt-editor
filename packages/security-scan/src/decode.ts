export interface DecodedHtml {
  text: string;
  /** WHATWG label actually used. */
  encoding: string;
  hasBom: boolean;
  /** True when the declared/assumed encoding produced replacement characters. */
  lossy: boolean;
}

const META_CHARSET = /<meta[^>]{0,200}?charset\s{0,8}=\s{0,8}["']?\s{0,8}([a-zA-Z0-9_:.-]{1,40})/i;

function tryDecode(bytes: Uint8Array, label: string, fatal: boolean): string | null {
  try {
    return new TextDecoder(label, { fatal, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * HTML byte sniffing: BOM, then <meta charset> in the first 1024 bytes, then UTF-8 if valid,
 * then EUC-KR (the common legacy Korean encoding), then lossy UTF-8.
 */
export function decodeHtml(bytes: Uint8Array): DecodedHtml {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return {
      text: new TextDecoder('utf-8').decode(bytes),
      encoding: 'utf-8',
      hasBom: true,
      lossy: false,
    };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      text: new TextDecoder('utf-16le').decode(bytes),
      encoding: 'utf-16le',
      hasBom: true,
      lossy: false,
    };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {
      text: new TextDecoder('utf-16be').decode(bytes),
      encoding: 'utf-16be',
      hasBom: true,
      lossy: false,
    };
  }
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  const declared = META_CHARSET.exec(head)?.[1]?.toLowerCase();
  if (declared) {
    const strict = tryDecode(bytes, declared, true);
    if (strict !== null) {
      return {
        text: strict,
        encoding: new TextDecoder(declared).encoding,
        hasBom: false,
        lossy: false,
      };
    }
    const lossy = tryDecode(bytes, declared, false);
    if (lossy !== null) {
      return {
        text: lossy,
        encoding: new TextDecoder(declared).encoding,
        hasBom: false,
        lossy: true,
      };
    }
  }
  const utf8 = tryDecode(bytes, 'utf-8', true);
  if (utf8 !== null) return { text: utf8, encoding: 'utf-8', hasBom: false, lossy: false };
  const euc = tryDecode(bytes, 'euc-kr', true);
  if (euc !== null) return { text: euc, encoding: 'euc-kr', hasBom: false, lossy: false };
  return {
    text: new TextDecoder('utf-8').decode(bytes),
    encoding: 'utf-8',
    hasBom: false,
    lossy: true,
  };
}
