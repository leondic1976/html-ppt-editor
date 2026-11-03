import { parse } from 'parse5';
import { decodeHtml } from './decode.js';
import { shrinkBlobs } from './shrink.js';
import {
  ABUSED_TLDS,
  KNOWN_CDN_HOSTS,
  RAW_PAYLOAD_HOSTS,
  SCRIPT_RULES,
  SIGNALS,
  URL_SHORTENERS,
} from './rules.js';
import { DANGEROUS_EXTENSIONS, decodeBase64, entropy, sniffImage, sniffMagic } from './sniff.js';
import type {
  Category,
  Finding,
  ScanOptions,
  ScanReport,
  ScanStats,
  Severity,
  Verdict,
} from './types.js';
import { SEVERITY_ORDER } from './types.js';

export const ENGINE_VERSION = '1.0.0';

const MAX_SCRIPT_TEXT = 8 * 1024 * 1024;
const MAX_BLOB_DECODE = 4 * 1024 * 1024;
const MAX_NODES = 2_000_000;
const MAX_RECURSION = 2;

/* The EICAR test string is split so this source file is not itself flagged by antivirus software. */
const EICAR = [
  'X5O!P%@AP[4',
  '\\PZX54(P^)7CC)7}$',
  'EICAR-STANDARD-',
  'ANTIVIRUS-TEST-FILE!$H+H*',
].join('');

interface AstNode {
  nodeName: string;
  tagName?: string;
  value?: string;
  data?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: AstNode[];
  content?: AstNode;
  sourceCodeLocation?: {
    startLine: number;
    startCol: number;
    startOffset: number;
    endOffset: number;
  } | null;
}

interface Ctx {
  findings: Map<string, Finding>;
  stats: ScanStats;
  limits: string[];
  domains: Set<string>;
  scriptCorpus: string[];
  deadline: number;
  depth: number;
  hasPasswordField: boolean;
  externalFormAction: boolean;
  source: string;
}

function clip(s: string, n = 140): string {
  const t = s.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function add(
  ctx: Ctx,
  ruleId: string,
  severity: Severity,
  category: Category,
  title: string,
  detail: string,
  loc?: { line?: number; column?: number; snippet?: string },
): void {
  const existing = ctx.findings.get(ruleId);
  if (existing) {
    existing.count++;
    return;
  }
  ctx.findings.set(ruleId, { ruleId, severity, category, title, detail, count: 1, ...loc });
}

function locOf(node: AstNode): { line?: number; column?: number } {
  const l = node.sourceCodeLocation;
  return l ? { line: l.startLine, column: l.startCol } : {};
}

function lineColAt(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let last = -1;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++;
    last = i;
  }
  return { line, column: offset - last };
}

/** Undo JS string escapes and literal concatenation so simple evasions meet the same rules. */
export function normalizeScript(src: string): string {
  return src
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u\{?([0-9a-fA-F]{4})\}?/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/["'`]\s*\+\s*["'`]/g, '');
}

function scanScriptText(ctx: Ctx, text: string, base?: AstNode, origin = '스크립트'): void {
  const body = text.length > MAX_SCRIPT_TEXT ? text.slice(0, MAX_SCRIPT_TEXT) : text;
  if (text.length > MAX_SCRIPT_TEXT) {
    ctx.limits.push(`큰 스크립트는 앞 ${MAX_SCRIPT_TEXT / 1024 / 1024}MB까지만 검사했습니다.`);
  }
  const normalized = normalizeScript(body);
  ctx.scriptCorpus.push(normalized === body ? body : `${body}\n${normalized}`);
  const baseLoc = base ? locOf(base) : {};
  for (const rule of SCRIPT_RULES) {
    if (Date.now() > ctx.deadline) {
      ctx.limits.push('시간 제한으로 일부 스크립트 규칙을 건너뛰었습니다.');
      return;
    }
    const hit = rule.re.exec(body);
    const viaNorm = !hit && normalized !== body ? rule.re.exec(normalized) : null;
    const m = hit ?? viaNorm;
    if (!m) continue;
    let loc: { line?: number; column?: number } = baseLoc;
    if (hit && baseLoc.line) {
      const rel = lineColAt(body, hit.index);
      loc = {
        line: baseLoc.line + rel.line - 1,
        column: rel.line === 1 ? (baseLoc.column ?? 1) + rel.column : rel.column,
      };
    }
    add(
      ctx,
      rule.id,
      rule.severity,
      rule.category,
      rule.title,
      rule.detail + (viaNorm ? ' (이스케이프를 풀어 확인)' : ''),
      {
        ...loc,
        snippet: clip(`${origin}: ${m[0]}`),
      },
    );
  }
  scanEmbeddedBlobs(ctx, body, baseLoc);
  scanObfuscationStats(ctx, body, baseLoc);
}

function scanObfuscationStats(
  ctx: Ctx,
  body: string,
  loc: { line?: number; column?: number },
): void {
  if (body.length < 2000) return;
  const longest = /[^\s"'`]{4000,}/.exec(body.slice(0, 2_000_000))?.[0];
  if (
    longest &&
    entropy(longest.slice(0, 20_000)) > 5.3 &&
    !/^[\w$]+$/.test(longest.slice(0, 200))
  ) {
    // High-entropy unbroken runs are only worth reporting when paired with an execution sink.
    if (/\beval\s*\(|new\s+Function|document\.write|atob\s*\(/.test(body)) {
      add(
        ctx,
        'obf.entropy',
        'medium',
        'obfuscation',
        '읽을 수 없는 대량의 코드 조각',
        '엔트로피가 높은 긴 문자열과 코드 실행 함수가 함께 있습니다.',
        loc,
      );
    }
  }
}

const B64_BLOB = /["'`]([A-Za-z0-9+/_-]{256,}={0,2})["'`]/g;

function scanEmbeddedBlobs(ctx: Ctx, text: string, loc: { line?: number; column?: number }): void {
  B64_BLOB.lastIndex = 0;
  let m: RegExpExecArray | null;
  let budget = 64;
  while ((m = B64_BLOB.exec(text)) && budget-- > 0) {
    const raw = m[1]!;
    const bytes = decodeBase64(raw, MAX_BLOB_DECODE);
    if (!bytes) continue;
    inspectPayload(ctx, bytes, '스크립트 내 Base64 데이터', loc);
  }
  if (budget <= 0) ctx.limits.push('Base64 덩어리가 많아 처음 64개만 해독했습니다.');
}

function inspectPayload(
  ctx: Ctx,
  bytes: Uint8Array,
  where: string,
  loc: { line?: number; column?: number },
  declaredMime?: string,
): void {
  const magic = sniffMagic(bytes);
  if (magic) {
    // Fonts and common images are ordinary; only flag what the sniffer recognises as a payload.
    add(
      ctx,
      `payload.${magic.kind}`,
      magic.severity,
      'executable',
      `${where}에 숨겨진 ${magic.label}`,
      `파일 안에 ${magic.label}이(가) 인코딩되어 들어 있습니다. 슬라이드 표시에 필요한 데이터가 아닙니다.`,
      loc,
    );
    return;
  }
  const latin = new TextDecoder('latin1').decode(bytes.subarray(0, MAX_BLOB_DECODE));
  if (latin.includes(EICAR)) {
    add(
      ctx,
      'sig.eicar',
      'critical',
      'test-signature',
      'EICAR 백신 테스트 문자열',
      `${where}에서 표준 백신 테스트 문자열을 찾았습니다. 실제 악성코드는 아니지만 백신은 악성으로 처리합니다.`,
      loc,
    );
    return;
  }
  if (ctx.depth >= MAX_RECURSION) return;
  const image = sniffImage(bytes);
  if (image && image !== 'svg') return;
  const looksLikeMarkup = /<\s*(?:script|html|svg|iframe|body)\b/i.test(latin.slice(0, 65536));
  if (image === 'svg' || looksLikeMarkup || declaredMime === 'text/html') {
    ctx.depth++;
    const text = new TextDecoder('utf-8').decode(bytes);
    walkHtml(ctx, text);
    ctx.depth--;
  } else if (
    /\b(?:eval|Function|document\.write|ActiveXObject|powershell)\b/.test(latin.slice(0, 1_000_000))
  ) {
    ctx.depth++;
    scanScriptText(ctx, latin, undefined, `${where}(해독)`);
    ctx.depth--;
  }
}

function hostOf(url: string): string | null {
  const m = /^(?:https?:|wss?:|ftp:)?\/\/([^/?#\s]+)/i.exec(url.trim());
  if (!m) return null;
  return m[1]!.replace(/^.*@/, '').replace(/:\d+$/, '').toLowerCase();
}

function stripUrlJunk(url: string): string {
  // Browsers ignore these characters when resolving a scheme.

  return url.replace(/[\u0000- \u007f-\u009f]+/g, '').toLowerCase();
}

function inspectUrl(ctx: Ctx, rawUrl: string, node: AstNode, kind: string): void {
  const url = rawUrl.trim();
  if (!url) return;
  const compact = stripUrlJunk(url);
  const loc = locOf(node);

  if (compact.startsWith('javascript:')) {
    add(
      ctx,
      'url.javascript',
      'high',
      'script',
      'javascript: URL',
      '링크나 리소스 주소에서 코드를 실행합니다.',
      { ...loc, snippet: clip(url) },
    );
    scanScriptText(ctx, url.slice(url.indexOf(':') + 1), node, 'javascript: URL');
    return;
  }
  if (compact.startsWith('vbscript:')) {
    add(
      ctx,
      'url.vbscript',
      'critical',
      'system-access',
      'vbscript: URL',
      'VBScript는 현대 발표 자료에서 쓰이지 않으며 시스템 공격에 악용됩니다.',
      { ...loc, snippet: clip(url) },
    );
    return;
  }
  if (/^(?:ms-msdt|search-ms|ms-officecmd|ms-appinstaller):/.test(compact)) {
    add(
      ctx,
      'sys.protocol-handler',
      'critical',
      'system-access',
      '위험한 프로토콜 처리기 호출',
      '알려진 원격 코드 실행 공격에 악용된 프로토콜입니다.',
      { ...loc, snippet: clip(url) },
    );
    return;
  }
  if (compact.startsWith('file:') || /^\\\\[^\\]/.test(url) || compact.startsWith('smb:')) {
    add(
      ctx,
      'url.local-or-smb',
      'high',
      'network',
      '로컬 파일 또는 네트워크 공유 참조',
      'file://, UNC(\\\\server), smb: 경로는 Windows 로그인 정보 유출이나 로컬 파일 접근에 악용될 수 있습니다.',
      { ...loc, snippet: clip(url) },
    );
    return;
  }
  if (compact.startsWith('data:')) {
    ctx.stats.dataUrls++;
    inspectDataUrl(ctx, url, node, kind);
    return;
  }

  const host = hostOf(url);
  if (!host) return;
  ctx.domains.add(host);
  const snippet = clip(url);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) {
    add(
      ctx,
      'url.ip-host',
      'medium',
      'network',
      'IP 주소로 된 외부 서버',
      '도메인 없이 IP로 접속합니다. 정상 서비스에는 드문 방식입니다.',
      { ...loc, snippet },
    );
  }
  if (host.includes('xn--')) {
    add(
      ctx,
      'url.punycode',
      'medium',
      'phishing',
      '퓨니코드 도메인',
      '다른 사이트처럼 보이게 만든 도메인일 수 있습니다.',
      { ...loc, snippet },
    );
  }
  if (URL_SHORTENERS.has(host)) {
    add(ctx, 'url.shortener', 'low', 'network', '단축 URL', '실제 목적지를 확인할 수 없습니다.', {
      ...loc,
      snippet,
    });
  }
  if (RAW_PAYLOAD_HOSTS.test(host)) {
    add(
      ctx,
      'url.payload-host',
      'high',
      'network',
      '파일·코드 임시 공유 사이트',
      '악성코드 배포에 자주 악용되는 공유 서비스입니다.',
      { ...loc, snippet },
    );
  }
  if (ABUSED_TLDS.test(host)) {
    add(
      ctx,
      'url.abused-tld',
      'low',
      'network',
      '악용이 잦은 최상위 도메인',
      '단독으로는 악성을 뜻하지 않습니다.',
      { ...loc, snippet },
    );
  }
  if (/^http:/i.test(url) && kind !== 'link') {
    add(
      ctx,
      'url.insecure',
      'low',
      'network',
      '암호화되지 않은 HTTP 리소스',
      '전송 중 변조될 수 있습니다.',
      { ...loc, snippet },
    );
  }
  if (kind === 'script' && /^https?:|^\/\//i.test(url) && !KNOWN_CDN_HOSTS.has(host)) {
    add(
      ctx,
      'script.unknown-host',
      'medium',
      'script',
      '알 수 없는 서버의 외부 스크립트',
      '내용을 검사할 수 없고 언제든 바뀔 수 있습니다. 이 에디터는 실행하지 않지만, 브라우저에서 원본을 직접 열면 실행됩니다.',
      { ...loc, snippet },
    );
  }
}

const DATA_URL = /^data:([^;,]{0,100})((?:;[^;,]{0,100}){0,8}),([\s\S]*)$/i;

function inspectDataUrl(ctx: Ctx, url: string, node: AstNode, kind: string): void {
  const m = DATA_URL.exec(url);
  if (!m) return;
  const mime = (m[1] ?? '').toLowerCase();
  const isB64 = /;base64/i.test(m[2] ?? '');
  const loc = locOf(node);
  if (
    /x-msdownload|x-msdos|x-dosexec|x-executable|x-sh\b|hta|octet-stream|x-msi|java-archive/.test(
      mime,
    )
  ) {
    add(
      ctx,
      'data.binary-mime',
      mime.includes('octet-stream') ? 'medium' : 'critical',
      'executable',
      `실행·이진 데이터 URL (${mime})`,
      '슬라이드에 필요 없는 형식의 데이터가 내장되어 있습니다.',
      { ...loc, snippet: clip(url, 80) },
    );
  }
  if (mime === 'text/html' && (kind === 'iframe' || kind === 'embed' || kind === 'link')) {
    add(
      ctx,
      'data.html-frame',
      'high',
      'embedding',
      'data: URL로 숨겨진 HTML',
      '검사를 피하려고 HTML을 데이터 URL 안에 넣는 수법입니다.',
      { ...loc, snippet: clip(url, 80) },
    );
  }
  let bytes: Uint8Array | null = null;
  if (isB64) bytes = decodeBase64(m[3] ?? '', MAX_BLOB_DECODE);
  else {
    try {
      bytes = new TextEncoder().encode(decodeURIComponent((m[3] ?? '').slice(0, MAX_BLOB_DECODE)));
    } catch {
      bytes = null;
    }
  }
  if (!bytes) return;
  if (isB64 && (m[3]?.length ?? 0) > (MAX_BLOB_DECODE * 4) / 3) {
    ctx.limits.push('큰 data: URL은 앞 4MB까지만 해독했습니다.');
  }
  inspectPayload(ctx, bytes, 'data: URL', loc, mime);
}

const CSS_URL = /url\(\s*["']?([^"')\s]{1,2048})["']?\s*\)|@import\s+["']([^"']{1,2048})["']/gi;

function scanCss(ctx: Ctx, css: string, node: AstNode): void {
  CSS_URL.lastIndex = 0;
  let m: RegExpExecArray | null;
  let budget = 5000;
  while ((m = CSS_URL.exec(css)) && budget-- > 0) {
    inspectUrl(ctx, (m[1] ?? m[2])!, node, 'css');
  }
  if (
    /input\s*\[\s*value\s*[\^$*]?=\s*["'][^"']{0,40}["']\s*\][^{]{0,100}\{[^}]{0,200}url\(/i.test(
      css,
    )
  ) {
    add(
      ctx,
      'css.value-exfil',
      'high',
      'css',
      'CSS 입력값 탈취 패턴',
      '입력값에 따라 외부 주소를 불러와 키 입력을 알아내는 CSS 공격 패턴입니다.',
      locOf(node),
    );
  }
  if (/expression\s*\(|behavior\s*:\s*url|-moz-binding/i.test(css)) {
    add(
      ctx,
      'css.code',
      'high',
      'css',
      'CSS 코드 실행 구문',
      'expression, behavior, -moz-binding은 CSS에서 코드를 실행하려는 오래된 공격 기법입니다.',
      locOf(node),
    );
  }
}

const SIZE_ZERO =
  /(?:^|;)\s*(?:width\s*:\s*0|height\s*:\s*0|display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?\s*(?:;|$)|left\s*:\s*-\d{3,}|top\s*:\s*-\d{3,})/i;

function attr(node: AstNode, name: string): string | undefined {
  return node.attrs?.find((a) => a.name === name)?.value;
}

function textOf(node: AstNode): string {
  return (node.childNodes ?? []).map((c) => c.value ?? '').join('');
}

function isExternal(url: string | undefined): boolean {
  return !!url && /^(?:https?:)?\/\//i.test(url.trim());
}

function walkHtml(ctx: Ctx, html: string): void {
  let doc: AstNode;
  try {
    doc = parse(html, { sourceCodeLocationInfo: ctx.depth === 0 }) as unknown as AstNode;
  } catch {
    ctx.limits.push('HTML 구문 분석에 실패한 부분이 있습니다.');
    return;
  }
  let visited = 0;
  const stack: AstNode[] = [doc];
  while (stack.length) {
    const node = stack.pop()!;
    if (++visited > MAX_NODES) {
      ctx.limits.push(`노드가 너무 많아 ${MAX_NODES.toLocaleString()}개까지만 검사했습니다.`);
      add(
        ctx,
        'res.node-count',
        'medium',
        'resource',
        '비정상적으로 많은 HTML 노드',
        '브라우저를 멈추게 할 수 있습니다.',
      );
      break;
    }
    if (Date.now() > ctx.deadline) {
      ctx.limits.push('시간 제한으로 문서 일부를 검사하지 못했습니다.');
      break;
    }
    if (node.nodeName === '#comment' && node.data) {
      if (/\[if\s[^\]]{0,60}\]/i.test(node.data) && /<script|<iframe|<object/i.test(node.data)) {
        add(
          ctx,
          'html.conditional-comment',
          'medium',
          'script',
          '조건부 주석 안의 활성 콘텐츠',
          '특정 브라우저에서만 실행되도록 숨긴 코드입니다.',
          locOf(node),
        );
      }
    }
    if (node.tagName) visitElement(ctx, node);
    if (node.childNodes)
      for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push(node.childNodes[i]!);
    if (node.content?.childNodes) stack.push(node.content);
  }
}

function visitElement(ctx: Ctx, node: AstNode): void {
  const tag = node.tagName!.toLowerCase();
  const loc = locOf(node);

  for (const a of node.attrs ?? []) {
    const name = a.name.toLowerCase();
    if (name.startsWith('on')) {
      ctx.stats.eventHandlers++;
      scanScriptText(ctx, a.value, node, `${tag}[${name}]`);
    } else if (name === 'style') {
      scanCss(ctx, a.value, node);
    } else if (name === 'srcdoc') {
      ctx.depth++;
      if (ctx.depth <= MAX_RECURSION) walkHtml(ctx, a.value);
      ctx.depth--;
    } else if (
      [
        'src',
        'href',
        'xlink:href',
        'data',
        'action',
        'formaction',
        'poster',
        'background',
        'ping',
      ].includes(name)
    ) {
      const kind =
        tag === 'script'
          ? 'script'
          : tag === 'a'
            ? 'link'
            : tag === 'iframe'
              ? 'iframe'
              : tag === 'embed' || tag === 'object'
                ? 'embed'
                : 'resource';
      inspectUrl(ctx, a.value, node, kind);
    }
  }

  switch (tag) {
    case 'script': {
      ctx.stats.scripts++;
      const src = attr(node, 'src');
      const type = (attr(node, 'type') ?? '').toLowerCase();
      if (src) ctx.stats.externalScripts++;
      if (/json|text\/plain|text\/template|text\/x-/.test(type)) {
        const body = textOf(node);
        if (body) inspectIfEncoded(ctx, body, loc);
        break;
      }
      const body = textOf(node);
      if (body) {
        ctx.stats.inlineScriptBytes += body.length;
        scanScriptText(ctx, body, node);
      }
      break;
    }
    case 'style':
      scanCss(ctx, textOf(node), node);
      break;
    case 'iframe':
    case 'frame': {
      ctx.stats.iframes++;
      const src = attr(node, 'src');
      const style = attr(node, 'style') ?? '';
      const hidden =
        attr(node, 'width') === '0' ||
        attr(node, 'height') === '0' ||
        attr(node, 'width') === '1' ||
        attr(node, 'height') === '1' ||
        attr(node, 'hidden') !== undefined ||
        SIZE_ZERO.test(style);
      if (hidden && (isExternal(src) || attr(node, 'srcdoc') !== undefined)) {
        add(
          ctx,
          'html.hidden-iframe',
          'high',
          'embedding',
          '숨겨진 외부 iframe',
          '보이지 않는 프레임으로 다른 페이지를 불러옵니다. 드라이브바이 공격의 전형입니다.',
          { ...loc, snippet: clip(src ?? 'srcdoc') },
        );
      } else if (isExternal(src)) {
        add(
          ctx,
          'html.external-iframe',
          'low',
          'embedding',
          '외부 페이지 포함(iframe)',
          '이 에디터에서는 불러오지 않습니다.',
          { ...loc, snippet: clip(src!) },
        );
      }
      break;
    }
    case 'object':
    case 'embed':
    case 'applet':
      add(
        ctx,
        'html.plugin-embed',
        'high',
        'embedding',
        `플러그인 콘텐츠(<${tag}>)`,
        '외부 프로그램·플러그인으로 실행되는 콘텐츠입니다. 현대 발표 자료에는 거의 쓰이지 않습니다.',
        {
          ...loc,
          snippet: clip(attr(node, 'data') ?? attr(node, 'src') ?? attr(node, 'code') ?? tag),
        },
      );
      break;
    case 'base':
      if (isExternal(attr(node, 'href'))) {
        add(
          ctx,
          'html.base-hijack',
          'high',
          'redirect',
          '기준 URL 변경(<base>)',
          '문서의 모든 상대 경로가 외부 서버를 가리키게 됩니다.',
          { ...loc, snippet: clip(attr(node, 'href')!) },
        );
      }
      break;
    case 'meta': {
      const equiv = (attr(node, 'http-equiv') ?? '').toLowerCase();
      const content = attr(node, 'content') ?? '';
      if (equiv === 'refresh' && /url\s*=/i.test(content)) {
        const target = /url\s*=\s*['"]?([^'"]+)/i.exec(content)?.[1] ?? '';
        add(
          ctx,
          'html.meta-refresh',
          isExternal(target) ? 'medium' : 'low',
          'redirect',
          '자동 페이지 이동(meta refresh)',
          '파일을 열면 다른 주소로 이동합니다.',
          { ...loc, snippet: clip(content) },
        );
        inspectUrl(ctx, target, node, 'link');
      } else if (equiv === 'set-cookie') {
        add(
          ctx,
          'html.meta-cookie',
          'medium',
          'script',
          'meta 태그로 쿠키 설정',
          '정상 문서에서는 쓰이지 않는 방식입니다.',
          loc,
        );
      }
      break;
    }
    case 'form': {
      const action = attr(node, 'action');
      if (isExternal(action)) ctx.externalFormAction = true;
      break;
    }
    case 'input':
      if ((attr(node, 'type') ?? '').toLowerCase() === 'password') {
        ctx.hasPasswordField = true;
        add(
          ctx,
          'html.password-field',
          'medium',
          'phishing',
          '비밀번호 입력란',
          '발표 자료에 비밀번호 입력란이 있는 것은 이례적입니다. 입력하지 마세요.',
          loc,
        );
      }
      break;
    case 'a': {
      const dl = attr(node, 'download');
      const href = attr(node, 'href') ?? '';
      const name = dl || href.split(/[?#]/)[0] || '';
      if (dl !== undefined && DANGEROUS_EXTENSIONS.test(name)) {
        add(
          ctx,
          'html.dangerous-download',
          'critical',
          'executable',
          '실행 파일 다운로드 링크',
          `클릭하면 실행 파일(${clip(name, 60)})이 내려받아집니다.`,
          { ...loc, snippet: clip(name) },
        );
      } else if (DANGEROUS_EXTENSIONS.test(name)) {
        add(
          ctx,
          'html.executable-link',
          'medium',
          'executable',
          '실행 파일로 연결되는 링크',
          `링크가 실행 파일(${clip(name, 60)})을 가리킵니다.`,
          { ...loc, snippet: clip(name) },
        );
      }
      break;
    }
    case 'link': {
      const rel = (attr(node, 'rel') ?? '').toLowerCase();
      if (rel.includes('import')) {
        add(
          ctx,
          'html.html-import',
          'medium',
          'embedding',
          'HTML Import',
          '폐기된 기능으로, 외부 코드를 끌어오는 데 쓰입니다.',
          loc,
        );
      }
      break;
    }
    case 'foreignobject':
      break;
    default:
      break;
  }
}

/** JSON/text-typed script blocks are not executed by browsers, yet can carry smuggled payloads. */
function inspectIfEncoded(ctx: Ctx, body: string, loc: { line?: number; column?: number }): void {
  if (body.length > 256) scanEmbeddedBlobs(ctx, body, loc);
}

function combine(ctx: Ctx): void {
  const corpus = ctx.scriptCorpus.join('\n');
  if (!corpus) {
    if (ctx.hasPasswordField && ctx.externalFormAction) {
      add(
        ctx,
        'combo.phishing-form',
        'critical',
        'phishing',
        '비밀번호를 외부로 보내는 입력 폼',
        '자격 증명 탈취(피싱) 페이지의 전형적인 구조입니다.',
      );
    }
    return;
  }
  const has = (s: keyof typeof SIGNALS): boolean => SIGNALS[s].test(corpus);
  if (ctx.hasPasswordField && (ctx.externalFormAction || has('network'))) {
    add(
      ctx,
      'combo.phishing-form',
      'critical',
      'phishing',
      '비밀번호를 외부로 보내는 입력 폼',
      '자격 증명 탈취(피싱) 페이지의 전형적인 구조입니다.',
    );
  }
  if (has('blobMake') && has('objectUrl') && has('triggerDownload') && has('binaryDecode')) {
    add(
      ctx,
      'combo.html-smuggling',
      'critical',
      'smuggling',
      'HTML 스머글링 패턴',
      '코드 안의 데이터를 파일로 조립해 자동으로 내려받게 합니다. 메일 필터를 우회해 악성 파일을 전달하는 대표적인 수법입니다.',
    );
  }
  if (has('keyListener') && has('network')) {
    add(
      ctx,
      'combo.keylogger',
      'high',
      'exfiltration',
      '키 입력 감지 + 외부 전송',
      '키 입력을 수집해 보내는 키로거일 수 있습니다. 슬라이드 넘김 코드라면 오탐일 수 있으니 외부 주소를 확인하세요.',
    );
  }
  if (has('sensitiveRead') && has('network')) {
    add(
      ctx,
      'combo.data-exfil',
      'high',
      'exfiltration',
      '저장 데이터 읽기 + 외부 전송',
      '쿠키나 로컬 저장소를 읽고 네트워크로 전송하는 코드가 함께 있습니다.',
    );
  }
  if (has('clipboardWrite') && has('shellInString')) {
    add(
      ctx,
      'combo.clipboard-shell',
      'critical',
      'social-engineering',
      '시스템 명령을 클립보드에 복사(ClickFix)',
      '사용자에게 명령을 붙여넣어 실행하게 만드는 공격입니다.',
    );
  } else if (has('clipboardWrite') && has('runDialogLure')) {
    add(
      ctx,
      'combo.clickfix-lure',
      'high',
      'social-engineering',
      '실행 창 붙여넣기 유도',
      '"Win+R 후 붙여넣기" 같은 안내로 명령 실행을 유도하는 패턴입니다.',
    );
  }
  if (has('passwordRead') && has('network') && !ctx.hasPasswordField) {
    add(
      ctx,
      'combo.password-script',
      'high',
      'phishing',
      '스크립트로 비밀번호 수집',
      '동적으로 만든 입력란에서 비밀번호를 읽어 보낼 수 있습니다.',
    );
  }
}

function verdictOf(findings: Finding[]): Verdict {
  const worst = SEVERITY_ORDER.find((s) => findings.some((f) => f.severity === s));
  switch (worst) {
    case 'critical':
      return 'malicious';
    case 'high':
      return 'dangerous';
    case 'medium':
      return 'suspicious';
    case 'low':
      return 'caution';
    default:
      return 'none-detected';
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const emptyStats = (size: number): ScanStats => ({
  size,
  scripts: 0,
  inlineScriptBytes: 0,
  externalScripts: 0,
  eventHandlers: 0,
  iframes: 0,
  dataUrls: 0,
  externalDomains: [],
});

function finish(
  ctx: Ctx,
  opts: ScanOptions,
  bytes: Uint8Array,
  hash: string,
  startedAt: number,
): ScanReport {
  const findings = [...ctx.findings.values()].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
  return {
    engine: { name: 'hps-static-scan', version: ENGINE_VERSION, rules: SCRIPT_RULES.length },
    fileName: opts.fileName ?? '(이름 없음)',
    sha256: hash,
    scannedAt: (opts.now?.() ?? new Date()).toISOString(),
    durationMs: Date.now() - startedAt,
    verdict: verdictOf(findings),
    findings,
    stats: { ...ctx.stats, size: bytes.length, externalDomains: [...ctx.domains].sort() },
    limits: [...new Set(ctx.limits)],
  };
}

function newCtx(size: number, budget: number): Ctx {
  return {
    findings: new Map(),
    stats: emptyStats(size),
    limits: [],
    domains: new Set(),
    scriptCorpus: [],
    deadline: Date.now() + budget,
    depth: 0,
    hasPasswordField: false,
    externalFormAction: false,
    source: '',
  };
}

/**
 * Static scan of a file offered as HTML. Reads bytes only; nothing in the file is ever executed,
 * so this is safe to run on hostile input and belongs in a Web Worker to keep the UI live.
 */
export async function scanHtmlFile(bytes: Uint8Array, opts: ScanOptions = {}): Promise<ScanReport> {
  const startedAt = Date.now();
  const ctx = newCtx(bytes.length, opts.timeBudgetMs ?? 20_000);
  const hash = await sha256(bytes);

  const magic = sniffMagic(bytes);
  if (magic && magic.kind !== 'gzip') {
    add(
      ctx,
      `file.${magic.kind}`,
      magic.severity === 'medium' ? 'high' : magic.severity,
      'executable',
      `HTML이 아닌 파일: ${magic.label}`,
      `파일 내용은 ${magic.label}입니다. 확장자를 바꿔 위장했을 수 있습니다. 열지 않습니다.`,
    );
    return finish(ctx, opts, bytes, hash, startedAt);
  }

  const latin = new TextDecoder('latin1').decode(bytes);
  if (latin.includes(EICAR)) {
    add(
      ctx,
      'sig.eicar',
      'critical',
      'test-signature',
      'EICAR 백신 테스트 문자열',
      '표준 백신 테스트 문자열입니다. 실제 악성코드는 아니지만 백신은 악성으로 처리합니다.',
    );
  }

  const text = decodeHtml(bytes).text;
  ctx.source = text;

  const nul = /\u0000/.exec(text.slice(0, 1_000_000));
  if (nul) {
    add(
      ctx,
      'file.nul-bytes',
      'medium',
      'resource',
      'HTML 안의 널 문자',
      '정상 텍스트 파일에는 없는 문자입니다. 바이너리이거나 필터 우회 시도일 수 있습니다.',
      lineColAt(text, nul.index),
    );
  }

  // Large base64 runs are inspected once, directly, then skipped by the character-at-a-time parser.
  const shrunk = shrinkBlobs(text);
  for (const blob of shrunk.blobs) {
    if (Date.now() > ctx.deadline) {
      ctx.limits.push('시간 제한으로 내장 데이터 일부를 검사하지 못했습니다.');
      break;
    }
    const decoded = decodeBase64(
      blob.slice(0, Math.ceil((MAX_BLOB_DECODE * 4) / 3 / 4) * 4),
      MAX_BLOB_DECODE,
    );
    if (decoded) inspectPayload(ctx, decoded, '내장 데이터', {});
    if (blob.length > (MAX_BLOB_DECODE * 4) / 3) {
      ctx.limits.push('큰 내장 데이터는 앞 4MB까지만 해독했습니다.');
    }
  }
  walkHtml(ctx, shrunk.text);
  combine(ctx);
  return finish(ctx, opts, bytes, hash, startedAt);
}

export interface AssetScanResult {
  ok: boolean;
  kind: string | null;
  findings: Finding[];
}

/** Check a file offered as an image (replacement photo, inserted picture) before it enters a deck. */
export function scanImageFile(
  bytes: Uint8Array,
  opts: { declaredMime?: string } = {},
): AssetScanResult {
  const ctx = newCtx(bytes.length, 5000);
  const magic = sniffMagic(bytes);
  const kind = sniffImage(bytes);
  if (magic) {
    add(
      ctx,
      `file.${magic.kind}`,
      'critical',
      'executable',
      `이미지가 아닌 파일: ${magic.label}`,
      '이미지로 위장한 파일입니다. 삽입하지 않습니다.',
    );
    return { ok: false, kind: null, findings: [...ctx.findings.values()] };
  }
  if (!kind) {
    add(
      ctx,
      'image.unknown',
      'medium',
      'resource',
      '이미지 형식을 확인할 수 없음',
      '파일 내용이 지원 이미지 형식과 맞지 않습니다.',
    );
    return { ok: false, kind: null, findings: [...ctx.findings.values()] };
  }
  if (
    opts.declaredMime?.startsWith('image/') &&
    !opts.declaredMime.includes(kind === 'jpeg' ? 'jp' : kind)
  ) {
    add(
      ctx,
      'image.mime-mismatch',
      'low',
      'resource',
      '확장자와 실제 형식이 다름',
      `실제 형식은 ${kind}입니다. 실제 형식으로 처리합니다.`,
    );
  }
  if (kind === 'png') {
    const latin = new TextDecoder('latin1').decode(bytes);
    const iend = latin.lastIndexOf('IEND');
    if (iend > 0 && bytes.length - (iend + 8) > 1024) {
      add(
        ctx,
        'image.trailing-data',
        'medium',
        'smuggling',
        '이미지 끝에 붙은 추가 데이터',
        '화면에 보이지 않는 데이터가 이미지 뒤에 붙어 있습니다. 데이터를 숨기는 수법일 수 있습니다.',
      );
    }
  }
  if (kind === 'svg') {
    // SVG is a document format; treat it as markup, since it can carry script.
    walkHtml(ctx, new TextDecoder('utf-8').decode(bytes));
    combine(ctx);
    const blocking = [...ctx.findings.values()].some((f) => f.severity === 'critical');
    return { ok: !blocking, kind, findings: [...ctx.findings.values()] };
  }
  return { ok: true, kind, findings: [...ctx.findings.values()] };
}
