import type { Category, Severity } from './types.js';

export interface PatternRule {
  id: string;
  severity: Severity;
  category: Category;
  title: string;
  detail: string;
  re: RegExp;
}

/*
 * Rules run on script text and on its escape-normalised form. Every pattern has bounded
 * quantifiers so a hostile file cannot cause catastrophic backtracking.
 */
export const SCRIPT_RULES: PatternRule[] = [
  /* ---- Known obfuscators ---- */
  {
    id: 'obf.packer',
    severity: 'high',
    category: 'obfuscation',
    title: 'Dean Edwards 패커로 난독화된 코드',
    detail:
      'eval(function(p,a,c,k,e,…) 형태입니다. 발표 자료에 필요한 경우가 드물고 악성 코드 은닉에 자주 쓰입니다.',
    re: /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,/,
  },
  {
    id: 'obf.identifiers',
    severity: 'high',
    category: 'obfuscation',
    title: '자동 난독화 도구의 변수명 패턴',
    detail:
      '_0x1a2b 형태의 식별자가 반복됩니다. javascript-obfuscator 계열 도구의 전형적인 결과입니다.',
    re: /(?:\b_0x[0-9a-f]{3,8}\b[\s\S]{0,200}?){8}/,
  },
  {
    id: 'obf.eval-decode',
    severity: 'high',
    category: 'obfuscation',
    title: '디코딩한 문자열을 바로 실행',
    detail:
      'atob/unescape/fromCharCode 결과를 eval·Function·document.write로 실행합니다. 숨겨진 코드를 실행하는 전형적인 방식입니다.',
    re: /(?:\beval|\bFunction|document\.write(?:ln)?)\s*\(\s*(?:[\w$.]{1,40}\s*\(\s*){0,3}(?:atob|unescape|decodeURIComponent|String\.fromCharCode)\s*\(/,
  },
  {
    id: 'obf.charcode-chain',
    severity: 'medium',
    category: 'obfuscation',
    title: '문자 코드로 문자열 조립',
    detail: 'String.fromCharCode에 긴 숫자 목록을 넘깁니다. 문자열을 숨기는 방법일 수 있습니다.',
    re: /fromCharCode\s*\(\s*(?:\d{1,5}\s*,\s*){16}/,
  },
  {
    id: 'obf.indirect-eval',
    severity: 'high',
    category: 'obfuscation',
    title: '우회한 eval 또는 Function 호출',
    detail:
      '문자열로 조립한 이름이나 constructor를 통해 코드 실행 함수를 부릅니다. 탐지 회피 목적일 수 있습니다.',
    re: /\[\s*["'`]ev["'`]\s*\+\s*["'`]al["'`]\s*\]|\[\s*["'`]eval["'`]\s*\]\s*\(|\.constructor\s*\.\s*constructor\s*\(|\.constructor\s*\(\s*["'`]return\b|\(\s*0\s*,\s*eval\s*\)\s*\(/,
  },

  /* ---- Dynamic code ---- */
  {
    id: 'js.eval',
    severity: 'medium',
    category: 'script',
    title: '동적 코드 실행(eval)',
    detail: '문자열을 코드로 실행합니다. 슬라이드 동작에 꼭 필요한 경우는 드뭅니다.',
    re: /(?<![\w$.])eval\s*\(/,
  },
  {
    id: 'js.function-ctor',
    severity: 'medium',
    category: 'script',
    title: '동적 코드 실행(new Function)',
    detail: '문자열로 함수를 만들어 실행합니다.',
    re: /new\s+Function\s*\(\s*(?!["'`]return this["'`]\s*\))/,
  },
  {
    id: 'js.document-write',
    severity: 'low',
    category: 'script',
    title: 'document.write 사용',
    detail:
      '페이지에 동적으로 HTML을 씁니다. 오래된 코드에도 흔하지만 악성 콘텐츠 주입에도 쓰입니다.',
    re: /document\.write(?:ln)?\s*\(/,
  },
  {
    id: 'js.wasm',
    severity: 'medium',
    category: 'script',
    title: 'WebAssembly 실행',
    detail:
      '컴파일된 바이너리 코드를 실행합니다. 내용을 정적으로 확인하기 어렵고 채굴기에 자주 쓰입니다.',
    re: /WebAssembly\s*\.\s*(?:instantiate|compile|instantiateStreaming|compileStreaming|Module)\b/,
  },

  /* ---- Crypto miners ---- */
  {
    id: 'miner.signature',
    severity: 'critical',
    category: 'miner',
    title: '암호화폐 채굴기 흔적',
    detail: '알려진 브라우저 채굴기 이름이나 채굴 프로토콜 문자열이 있습니다.',
    re: /\b(?:coinhive|coin-hive|cryptonight|cryptoloot|crypto-loot|webminer|webminerpool|deepminer|xmrig|minero\.cc|jsecoin|monerominer|authedmine)\b|CoinHive\.Anonymous|stratum\+(?:tcp|ssl):\/\//i,
  },

  /* ---- Local system access ---- */
  {
    id: 'sys.activex',
    severity: 'critical',
    category: 'system-access',
    title: 'Windows 시스템 접근 시도(ActiveX/WSH)',
    detail:
      'ActiveXObject·WScript.Shell·FileSystemObject는 명령 실행과 파일 조작에 쓰입니다. 발표 자료에 필요하지 않습니다.',
    re: /new\s+ActiveXObject\s*\(|WScript\.Shell|Scripting\.FileSystemObject|Shell\.Application|ADODB\.Stream/i,
  },
  {
    id: 'sys.shell-command',
    severity: 'critical',
    category: 'system-access',
    title: '시스템 명령어 문자열',
    detail:
      'PowerShell 인코딩 명령, mshta, certutil, rundll32 등 악성코드가 자주 쓰는 실행 명령이 들어 있습니다.',
    re: /powershell(?:\.exe)?\s+(?:-[a-z]{1,20}\s+){0,4}-(?:e|ec|enc|encodedcommand|w\s+hidden|windowstyle\s+hidden)\b|\bmshta(?:\.exe)?\s+\S|\bcertutil(?:\.exe)?\s+-(?:urlcache|decode)|\brundll32(?:\.exe)?\s+\S|\bbitsadmin\s+\/transfer|\bcmd(?:\.exe)?\s+\/c\s+\S|\bcurl\s+\S{1,200}\s*\|\s*(?:ba)?sh\b|Invoke-(?:Expression|WebRequest)\b|\biex\s*\(/i,
  },
  {
    id: 'sys.protocol-handler',
    severity: 'critical',
    category: 'system-access',
    title: '위험한 프로토콜 처리기 호출',
    detail:
      'ms-msdt:, search-ms:, ms-officecmd: 등은 알려진 원격 코드 실행 공격에 악용된 프로토콜입니다.',
    re: /\b(?:ms-msdt|search-ms|ms-officecmd|ms-appinstaller|ms-word|ms-excel|ms-powerpoint):[^\s"'`]{1,4}/i,
  },

  /* ---- Exfiltration primitives (combined into higher-severity findings in scan.ts) ---- */
  {
    id: 'net.exfil-endpoint',
    severity: 'high',
    category: 'exfiltration',
    title: '데이터 수집용 외부 주소',
    detail:
      'Telegram 봇 API, Discord 웹훅, webhook.site 등 탈취 데이터 전송에 자주 쓰이는 주소입니다.',
    re: /api\.telegram\.org\/bot|discord(?:app)?\.com\/api\/webhooks|webhook\.site|requestbin\.|pipedream\.net|ngrok(?:-free)?\.(?:io|app)|burpcollaborator\.net|interact\.sh|oast\.(?:fun|live|site|online|me|pro)/i,
  },
  {
    id: 'net.service-worker',
    severity: 'medium',
    category: 'network',
    title: '서비스 워커 등록',
    detail: '페이지를 닫아도 동작이 남을 수 있는 백그라운드 스크립트를 등록합니다.',
    re: /serviceWorker\s*\.\s*register\s*\(/,
  },
  {
    id: 'net.webrtc',
    severity: 'low',
    category: 'network',
    title: 'WebRTC 연결',
    detail: '내부 IP 수집이나 우회 통신에 쓰일 수 있습니다.',
    re: /new\s+(?:webkit)?RTCPeerConnection\s*\(/,
  },

  /* ---- Page control ---- */
  {
    id: 'nav.unload-trap',
    severity: 'medium',
    category: 'social-engineering',
    title: '페이지 이탈 방해',
    detail: '창을 닫으려 할 때 경고를 띄워 사용자를 붙잡습니다. 사기성 경고 페이지에서 흔합니다.',
    re: /(?:onbeforeunload\s*=|addEventListener\s*\(\s*["'`]beforeunload["'`])/,
  },
  {
    id: 'nav.script-redirect',
    severity: 'medium',
    category: 'redirect',
    title: '스크립트로 외부 페이지 이동',
    detail: '열자마자 다른 사이트로 보낼 수 있습니다.',
    re: /(?:window\.|document\.|top\.|self\.|parent\.)?location(?:\.href)?\s*=\s*["'`]https?:\/\/|location\.(?:replace|assign)\s*\(\s*["'`]https?:\/\//,
  },
  {
    id: 'nav.frame-bust',
    severity: 'low',
    category: 'redirect',
    title: '상위 창 조작',
    detail: 'top.location을 변경해 상위 창을 이동시키려 합니다.',
    re: /top\.location\s*=|parent\.location\s*=/,
  },
];

/** Primitive signals; alone they are normal in slide decks, so they only count in combination. */
export const SIGNALS = {
  keyListener: /addEventListener\s*\(\s*["'`]key(?:down|press|up)["'`]|onkey(?:down|press|up)\s*=/,
  network:
    /\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|new\s+WebSocket|new\s+Image\s*\(\s*\)\s*\.src|\.src\s*=\s*["'`]https?:/,
  sensitiveRead: /document\.cookie|localStorage|sessionStorage|indexedDB\.open/,
  blobMake: /new\s+Blob\s*\(|new\s+File\s*\(/,
  objectUrl: /URL\.createObjectURL|msSaveOrOpenBlob|msSaveBlob/,
  triggerDownload: /\.download\s*=|\.click\s*\(\s*\)|msSaveOrOpenBlob|msSaveBlob/,
  binaryDecode: /atob\s*\(|Uint8Array|fromCharCode|charCodeAt/,
  clipboardWrite: /navigator\.clipboard\.writeText|document\.execCommand\s*\(\s*["'`]copy["'`]/,
  runDialogLure:
    /Win(?:dows)?\s*(?:\+|키)\s*R|실행\s*창|Press\s+(?:the\s+)?Win|Ctrl\s*\+\s*V|verify\s+you\s+are\s+human|로봇이\s*아닙니다|I'?m\s+not\s+a\s+robot/i,
  shellInString: /powershell|cmd\.exe|mshta|curl\s/i,
  passwordRead: /type\s*=\s*["'`]password|\.password\b|querySelector[^)]{0,60}password/i,
} as const;

/** Package mirrors commonly used by legitimate slide decks; lowers noise for external assets. */
export const KNOWN_CDN_HOSTS = new Set([
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'unpkg.com',
  'cdn.tailwindcss.com',
  'code.jquery.com',
  'ajax.googleapis.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.plot.ly',
  'esm.sh',
  'stackpath.bootstrapcdn.com',
  'maxcdn.bootstrapcdn.com',
  'use.fontawesome.com',
  'kit.fontawesome.com',
]);

export const URL_SHORTENERS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'is.gd',
  'ow.ly',
  'buff.ly',
  'cutt.ly',
  'rebrand.ly',
  'rb.gy',
  'shorturl.at',
]);

export const ABUSED_TLDS = /\.(?:zip|mov|top|xyz|click|country|gq|tk|ml|cf|ga|work|rest|monster)$/i;

export const RAW_PAYLOAD_HOSTS =
  /(?:^|\.)(?:pastebin\.com|paste\.ee|transfer\.sh|anonfiles\.com|temp\.sh|catbox\.moe|file\.io)$/i;
