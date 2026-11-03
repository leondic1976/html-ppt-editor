# Phase 0 오픈소스 실사 보고서

- 기준일: 2026-11-02
- 대상 질문: 독자 개발 / 특정 패키지 재사용 / 포크 중 무엇을 택할 것인가 (`plan.md` 1.3)
- 방법: `git clone --depth 50` 후 정적 읽기만 수행. **설치·빌드·실행은 하지 않았다.**

## 표기법

모든 주장에 근거 수준을 붙였다. 경로는 각 저장소 루트 기준이다.

| 태그     | 의미                                                                   |
| -------- | ---------------------------------------------------------------------- |
| [소스]   | 클론한 소스에서 직접 읽어 확인. 파일·줄 번호 표기                      |
| [외부]   | 저장소 밖 공식 페이지·상위 저장소 원문을 조회해 확인. 실행은 하지 않음 |
| [추론]   | 소스와 웹 플랫폼 명세를 근거로 한 판단. **실행으로 검증하지 않음**     |
| [미검증] | 일반 지식에 의존하거나 확인하지 못함                                   |

## 감사 대상과 커밋

| 대상                                 | 커밋       | 비고                                              |
| ------------------------------------ | ---------- | ------------------------------------------------- |
| Trade-Offf/NextPPT                   | `5ab622a6` | 얕은 클론, 50커밋                                 |
| archlizheng/frontend-slides-editable | `e5663e6a` | 전체 22커밋                                       |
| arifszn/slide-wright                 | `a751585b` | 얕은 클론. "Slidewright"의 최근접 후보 (5.1 참고) |
| mgritzbach/slidewright               | `851bbeb`  | 동명 프로젝트. 정체 확인 수준만 조사              |

---

## 1. 결론

**권고: 편집 코어는 독자 개발하고, 특정 패키지와 MIT 기법만 선별 재사용한다. 포크하지 않는다.**

결정적 근거는 다음과 같다.

1. **원본 보존 요건을 충족하는 프로젝트가 없다.** `plan.md` L1은 원본 바이트 보관과 패치 저널을 요구한다. NextPPT와 frontend-slides-editable은 모든 저장 경로가 DOM 재직렬화이고, slide-wright에는 편집 코드 자체가 없다. [소스]
2. **NextPPT의 격리 구조가 계획의 보안 조건과 정반대다.** 가져온 HTML의 JS가 에디터와 같은 출처에서 실행되며, 같은 출처의 IndexedDB에 폴더 핸들이 저장된다. [소스] 계획은 레거시 JS를 에디터 페이지에서 실행하지 않도록 요구한다.
3. **NextPPT의 PPTX는 슬라이드 전체 스크린샷이다.** 편집 우선 모드에 쓸 코드가 없다. [소스] 네이티브 텍스트 추출 구현은 slide-wright에만 있고, 약 300줄의 MIT 코드라 이식 비용이 낮다. [소스]
4. **포크해도 안전망을 물려받지 못한다.** NextPPT는 호스팅 중단을 공지했고, 테스트 파일은 1개, CI는 없다. [소스]

### 계획서 수정 사항

- **NextPPT 행(`plan.md:34`)**: "이미지 기반 PPTX 중심인지 검증 필요"를 "이미지 전용으로 확인"으로 갱신한다. [소스]
- **Slidewright 행(`plan.md:36`)**: "HTML 슬라이드 시각 편집 도구 사례"라는 설명은 근거가 없다. 해당 이름의 시각 편집기를 찾지 못했다. (5.1 참고)
- **`plan.md:48`의 재현 항목은 미완료다.** NextPPT를 설치해 실제 HTML 3종으로 왕복 시험하는 일은 이번 실사의 "실행 금지" 규칙상 수행하지 않았다. (7장 참고)

---

## 2. 비교 요약

| 항목                | NextPPT              | frontend-slides-editable   | slide-wright                     |
| ------------------- | -------------------- | -------------------------- | -------------------------------- |
| 성격                | 웹 앱 + 내보내기 API | AI 스킬 + 덱 내장 런타임   | AI 스킬 + 내보내기 CLI           |
| 임의 HTML 시각 편집 | 가능                 | 불가 (DOM 계약 필요)       | 불가 (시각 편집기 없음)          |
| 라이선스            | MIT                  | MIT                        | MIT                              |
| 최근 커밋           | 2026-08-31           | 2026-07-01                 | 2026-10-24                       |
| 유지보수            | 호스팅 중단 공지     | 중단 공지 없음, 4개월 정체 | 활동 중                          |
| 저장 방식           | DOM 재직렬화         | DOM 재직렬화 + JSON 상태   | 해당 없음 (에이전트가 파일 수정) |
| JS 격리             | 없음 (같은 출처)     | 없음 (iframe 자체 없음)    | 해당 없음                        |
| PPTX                | 전면 이미지          | 내보내기 없음              | 텍스트 네이티브 + 배경 이미지    |
| PDF                 | 스크린샷 삽입        | 내보내기 없음              | 브라우저 인쇄 (수동)             |
| 서버/런타임 의존    | 로컬 API + Puppeteer | 없음                       | Node + Playwright CLI            |
| 자동 테스트         | 1개 파일, 12건       | Python 검증·스모크         | `test()` 42건                    |
| CI                  | 없음                 | 없음                       | GitHub Actions                   |
| 잠금 파일           | 있음                 | npm만 있음, Python 없음    | 없음                             |

---

## 3. NextPPT

### 3.1 라이선스, 커밋, 유지보수

- 라이선스: MIT, `Copyright (c) 2026 HTML Deck Studio` (`LICENSE:1-3`). [소스]
- 최근 커밋: 2026-08-31 22:45 +0800 (`5ab622a`). [소스]
- 중단 공지 (`README.md:20`): [소스]

  > `next-ppt.com` **is no longer operated or maintained.** The repo stays MIT; if you want the tool, **clone it and run it locally**

  같은 절의 `README.md:30`에는 "NextPPT stays here as code. The hosted site will not. Forks welcome."라고 되어 있다. 문구상 중단 대상은 호스팅 사이트이지만, `README.md:130` 부근의 안내도 "no longer scheduled as a hosted product"이므로 활발한 유지보수를 기대하기 어렵다. [추론]

- 서드파티 고지 파일(NOTICE, THIRD_PARTY)이 없다. [소스]

포크 시 정리해야 할 항목:

| 항목                                                                                                                                            | 근거                                                                           | 수준                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| GSAP 3.15. 표준 라이선스가 코드 없이 시각 애니메이션을 만드는 도구 중 Webflow와 경쟁하는 용도를 금지함. 애니메이션 편집 UI를 추가하면 저촉 가능 | `apps/web/package.json`, `apps/web/src/lib/gsap.ts`, gsap.com/standard-license | [소스] 사용 / [외부] 조항 / 법률 판단 아님                         |
| `LiquidEther.tsx` 1,230줄에 출처 표기 없음. React Bits에 같은 이름의 컴포넌트가 있고 그 라이선스는 MIT + Commons Clause 계열                    | `apps/web/src/components/LiquidEther.tsx:1-12`                                 | [소스] 표기 없음 / [외부] 라이선스 / **동일 코드 여부는 [미검증]** |
| 실존 인물 이미지 7개(`jobs.png`, `musk.png`, `jensen.png` 등). 권리 정보 없음                                                                   | `apps/web/public/parallel/`, `ParallelBackstage.tsx`                           | [소스]                                                             |
| 원작자 토큰이 박힌 Cloudflare 분석 비콘. 로컬 실행에서도 로드됨                                                                                 | `apps/web/index.html:38`                                                       | [소스]                                                             |

모두 편집기 핵심과 무관한 랜딩 페이지 요소이므로, 코드를 선별 재사용하면 함께 피할 수 있다.

### 3.2 편집 저장 방식

**DOM 직렬화다. 원본 바이트와 서식을 유지하지 못한다.** [소스]

전송 계층에는 `PatchOp`(text/attr/style/class)가 있지만 살아 있는 DOM에 적용한 뒤 섹션 전체를 직렬화한다(`editor-runtime.ts:752-773`, `:872-878`). 즉 패치는 메시지 형식일 뿐 저장 형식이 아니다.

| 경로             | 직렬화 위치                                                            |
| ---------------- | ---------------------------------------------------------------------- |
| 슬라이드 편집    | `apps/web/src/runtime/editor-runtime.ts:809-816` (`clone.outerHTML`)   |
| 덱 재조립        | `apps/web/src/fs/adapter.ts:357-375` (`doc.documentElement.outerHTML`) |
| 문서 모드 재조립 | `adapter.ts:404-420`                                                   |
| HTML 작업대      | `apps/web/src/runtime/live-runtime.ts:1062-1070`                       |

작성자도 이 손실을 알고 있다. `assetResolver.ts:100-102`의 주석은 outerHTML 재직렬화가 속성 순서를 바꾸고 자기 닫힘 태그를 정규화한다고 적고 있다. `normalizeDeck.ts:150-154`의 "byte-for-byte" 보존은 열 때만 해당하며 첫 저장에서 사라진다.

코드 경로상 확인되는 **조용한 손실**은 다음과 같다. 코드는 읽었으나 실행하지 않았다.

1. **스크립트 소실.** `disableScripts()`가 `<script>`를 빈 `<template data-hds-disabled>`로 교체하고 원문은 `WeakMap`에만 둔다(`editor-runtime.ts:777-788`). `serializeSection()`은 이를 복원하지 않는다(`:809-817`). 복원 메시지 `disable-scripts`는 수신부(`:953`)와 타입(`packages/protocol/src/messages.ts:106`)만 있고 `apps/web/src`에 송신부가 없다. 문서 모드는 body 전체가 루트이므로 편집 후 저장하면 body 스크립트가 전부 사라진다(`adapter.ts:164-171`, `:418`). [소스]
2. **단일 파일 모드에서 원본 자산 경로와 CSS가 영구 변경.** 상대 이미지 경로를 플레이스홀더로 치환하고 `.slide` CSS의 `display:none`과 `position:absolute` 등을 정규식으로 바꾼다(`assetResolver.ts:146-172`). 그 결과가 `rawHtml`이 되어 저장본의 기준이 된다(`useOpenDeck.ts:108-111`, `EditorPage.tsx:337-340`). 또 `split/join` 전역 치환이라 같은 문자열의 다른 위치까지 바뀐다. [소스]
3. **이동 모드 진입만으로 레이아웃 변환.** `detachAll()`이 흐름 요소를 px 고정 `position:absolute`로 바꾸고 숨은 placeholder를 삽입하며, 바로 `patched`를 보낸다(`editor-runtime.ts:621` 이후, `:917-918`). [소스]
4. **편집기 마커 잔존.** `data-page-id`, `data-hds-id`, `data-hds-free`, `data-hds-placeholder`를 저장 전에 제거하지 않는다. `cleanup()`은 overlay/guide/warn만 지운다(`editor-runtime.ts:803-807`). [소스]
5. **구조 변경.** 비표준 덱은 `<section class="slide">`로 감싸 저장된다(`normalizeDeck.ts:92-114`). [소스]
6. **인라인 서식 소실.** 속성 패널의 텍스트 변경은 `el.innerHTML = escapeHtml(...)`이라 하위 인라인 태그가 사라진다(`editor-runtime.ts:760`). [소스]
7. **자동 저장.** 위 변경이 디바운스 자동 저장으로 바로 기록된다(`README.md:74`). 다만 원본 파일을 덮어쓰지는 않는다(아래 "좋은 점" 참고). [소스]

좋은 점: 저장 대상은 항상 `-hds.html` 사본이며(`deckStore.ts:159`, `:165`), 원본 덮어쓰기를 코드로 막고(`adapter.ts:219-222`), 폴더 모드에서는 타임스탬프 백업을 남긴다(`adapter.ts:235-262`). [소스]

### 3.3 격리와 보안

**가져온 HTML의 JS는 에디터와 같은 출처에서 실행된다.** [소스 + 추론]

- 편집 캔버스, HTML 작업대, 썸네일 iframe 모두 `srcdoc` + `sandbox="allow-same-origin allow-scripts"`이다(`CanvasFrame.tsx:148-149`, `LiveFrame.tsx:54-55`, `slideSnapshot.ts:122`). [소스]
- srcdoc 문서는 부모 출처를 상속하므로 이 조합은 격리가 아니다. 부모가 `el.contentDocument`를 직접 읽는 코드(`CanvasFrame.tsx:103`, `slideSnapshot.ts:78-79`)가 같은 출처임을 보여 준다. `LiveFrame.tsx:64-66` 주석의 "origin is about:srcdoc"은 잘못된 이해다. [소스 + 명세]
- `disableScripts()`는 격리가 아니다. 런타임이 body 맨 끝에 있어(`CanvasFrame.tsx:82`) head와 슬라이드 내부의 일반 스크립트가 **이미 실행된 뒤** 동작한다. 인라인 이벤트 핸들러도 막지 않는다. [소스 + 명세]
- 작업대는 사용자 스크립트를 의도적으로 실행한다(`live-runtime.ts:4-6`). [소스]
- CSP가 없다(`index.html`, `Caddyfile`, `_headers`에서 미발견). [소스]

구체적 약점:

| #   | 약점                                                                                                                                                                        | 근거                                                                              | 수준                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | **덱 JS가 폴더 핸들에 접근 가능.** `hds-v1` DB의 `handles` 저장소에 readwrite 디렉터리 핸들이 있음. 권한이 허용된 세션이면 덱이 폴더 전체를 읽고 쓸 수 있음                 | `adapter.ts:10-11`, `:39-47`, `:64`                                               | 경로 [소스] / 악용 [추론, PoC 미실행]                                                     |
| 2   | **샌드박스 탈출.** 같은 출처이므로 `parent` DOM 접근과 `sandbox` 제거가 가능                                                                                                | `CanvasFrame.tsx:149`                                                             | [추론]                                                                                    |
| 3   | **내보내기 API가 인증 없이 `0.0.0.0` 수신.** 기본 HOST가 전체 인터페이스라 같은 LAN에서 접근 가능                                                                           | `apps/api/src/server.ts:28-30`                                                    | [소스]                                                                                    |
| 4   | **업로드 HTML을 `--no-sandbox` Chromium에서 JS·네트워크 허용 상태로 실행**                                                                                                  | `screenshotter.ts:44-54`, `:67-68`, `documentRenderer.ts:47-68`                   | [소스]                                                                                    |
| 5   | **외부 사이트의 요청 유발.** CORS는 응답 읽기만 막고, 커스텀 헤더 없는 multipart POST는 사전 요청 없이 도달함. 서버 측 Origin 검사가 없음                                   | `routes/export.ts:231-300`                                                        | 코드 [소스] / 브라우저의 로컬 네트워크 차단 영향 [미검증]                                 |
| 6   | **로컬 파일 노출.** `file://`로 연 페이지가 다른 `file://`를 iframe으로 띄우면 스크린샷에 찍힐 수 있음. 3번과 결합 시 LAN에서 파일 내용 탈취 가능성                         | `screenshotter.ts:67`                                                             | [추론, 미실행]                                                                            |
| 7   | **SSRF.** 요청 차단이 없어 내부망 응답을 렌더링할 수 있음                                                                                                                   | `screenshotter.ts` 전체에 요청 가로채기 없음                                      | [소스] 부재 / 악용 [추론]                                                                 |
| 8   | **미리보기 정제 우회.** `sanitizePreviewDoc`은 script, `on*`, 일부 속성의 `javascript:`만 제거. 중첩 `<iframe srcdoc>`은 제거하지 않으며, 썸네일 iframe은 스크립트를 허용함 | `previewSanitize.ts:12-33`, `slideSnapshot.ts:122`                                | [소스] 누락 / 실행 [추론]                                                                 |
| 9   | **원격 코드 로드.** 고정되지 않은 메이저 범위 `mermaid@10`을 jsDelivr에서 동적 import. 무결성 검사 없음                                                                     | `editor-runtime.ts:724-726`, `screenshotter.ts:102`                               | [소스]                                                                                    |
| 10  | **메시지 검증 부족.** 런타임 수신부에 source 검사가 없음(작업대 런타임에는 있음). 부모는 source만 확인하고 내용은 신뢰함                                                    | `editor-runtime.ts:856-858`, `live-runtime.ts:1074-1075`, `CanvasFrame.tsx:88-89` | [소스]                                                                                    |
| 11  | **경로 조작 방어가 의존성에 위임됨.** 서버는 `part.filename`을 그대로 `path.join`함. 현재는 busboy의 basename 처리로 막힘                                                   | `routes/export.ts:241`, `:277`, fastify/busboy 원문                               | [소스] + [외부]. `main` 기준이며 잠금 버전(busboy 3.2.0, multipart 9.4.0) 원문은 [미검증] |

좋은 사례 하나: 히스토리 미리보기는 정제 후 `sandbox=""`를 쓴다(`HistoryDrawer.tsx:53-54`, `:141-142`). [소스]

### 3.4 PPTX와 PDF

- **PPTX는 네이티브 객체가 아니라 슬라이드 전체 이미지다.** 슬라이드마다 `addImage` 1회뿐이다(`apps/api/src/services/pptxBuilder.ts:31-44`). README도 "Image-based PPTX / PDF"라고 명시한다(`README.md:100`). [소스]
- 라이브러리: `pptxgenjs@3.12.0`(`pnpm-lock.yaml:1913`), Puppeteer 24.43.1. [소스]
- **PDF도 스크린샷을 `pdf-lib`로 삽입한다**(`pdfBuilder.ts:26-35`). 텍스트 선택과 검색이 안 되는 래스터 PDF다. `page.pdf()`는 이모지 누락 때문에 버렸다고 적혀 있다(`documentRenderer.ts:27-29`). [소스] 이미지 픽셀 수를 그대로 PDF 포인트로 쓰므로 페이지가 매우 크다(`pdfBuilder.ts:33`). [소스]
- **서버 의존성이 있다.** 편집은 브라우저 안에서 끝나지만 내보내기는 Fastify + Puppeteer가 필요하다(`README.md:93`, `ExportDrawer.tsx:103`). 공개 인스턴스는 없다(`README.md:119`). "local-first"는 로컬 Node 서버를 띄운다는 뜻이다. [소스]
- **1280×720 고정.** 내보내기 뷰포트(`routes/export.ts:97-98`), 캔버스(`CanvasFrame.tsx:58-75`), 런타임(`editor-runtime.ts:1031`). PPTX 이미지는 슬라이드에 100%로 늘려 넣어(`pptxBuilder.ts:41-42`) 비율이 다른 덱은 왜곡될 수 있다. [소스 + 추론]
- **폴더 모드 내보내기에서 하위 폴더 자산이 깨질 가능성.** 클라이언트는 `assets/x.png`처럼 경로 포함 이름을 보내지만(`ExportDrawer.tsx:26-31`), busboy는 `preservePath` 없이는 basename만 남기고 이 프로젝트는 옵션을 설정하지 않는다(`server.ts:20`). 그러면 `assets/x.png` 참조가 404가 된다. [소스 + 외부 + 추론] **재현 시험에서 먼저 확인할 항목이다.**
- 업로드 확장자에 `.js`와 영상이 없어(`ExportDrawer.tsx:29`) 로컬 JS나 영상에 의존하는 덱은 내보내기에서 깨질 수 있다. [소스 + 추론]
- 브라우저: Chromium 계열만 지원, Safari/Firefox는 계획 단계(`README.md:111`). [소스]

### 3.5 테스트, 빌드, 규모

- 테스트: `apps/web/src/fs/normalizeDeck.test.ts` 1개, `it` 12건. 저장 왕복, 런타임, API, E2E 테스트 없음. `.github` 없음. [소스]
- 잠금 파일: `pnpm-lock.yaml` v9, Docker는 `--frozen-lockfile`(`apps/api/Dockerfile:37`). `.nvmrc`는 20. [소스]
- 재현성 우려 [소스]:
  - `pnpm-workspace.yaml:10` `dangerouslyAllowAllBuilds: true`, `:15` `minimumReleaseAge: 0`
  - `vite-react-ssg` 베타 고정
  - `apps/api/package.json`의 `build`는 `tsc --noEmit`인데 `start`는 `node dist/server.js`라 스크립트만으로는 실행 불가. Docker는 `tsx`로 우회함(`Dockerfile:47`)
- 규모: TS/TSX 18,050줄. i18n과 `data/templates.ts`를 빼면 14,218줄. 런타임 2개 2,655줄. API 1,013줄. [소스]

### 3.6 재사용하거나 배울 것

| 대상                                        | 내용                                                                             | 방식                            |
| ------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------- |
| `apps/web/src/fs/normalizeDeck.ts` + 테스트 | 슬라이드 컨테이너 탐지 규칙, 확신도 개념. `plan.md`의 가져오기 4단계와 일치      | 탐지 부분만 이식, 직렬화는 제거 |
| `adapter.ts:219-222`, `:235-262`            | 원본 덮어쓰기 금지 가드, 백업 정리                                               | 기법 참고                       |
| `live-runtime.ts:14-18`                     | 독립 CSS `translate`/`scale`로 이동해 기존 `transform`과 충돌하지 않게 하는 방식 | 기법 참고                       |
| `live-runtime.ts:30-40`                     | 발표 키와 편집 키 충돌을 해결하는 탐색/편집 모드 구분                            | 기법 참고                       |
| `live-runtime.ts:1051-1058`                 | 페이지 탐지를 일부러 구현하지 않은 이유. 오탐이 표시 없음보다 나쁘다는 판단      | 설계 참고                       |
| `CanvasFrame.tsx:46-78`                     | 문서 스타일 앞/뒤에 넣는 리셋과 오버라이드의 순서                                | 기법 참고                       |
| `editor-runtime.ts:621` 이후                | 측정 → 자리 확보 → 재측정 후 고정의 3단계 분리. L2 변환 시 참고                  | 기법 참고                       |
| `routes/export.ts`                          | 작업 큐, SSE 재연결, Range 다운로드. 선택 서버를 만들 때 참고                    | 기법 참고                       |

**따라 하면 안 되는 것:** `allow-same-origin allow-scripts` 조합, IndexedDB 핸들 저장을 같은 출처에 두는 구조, outerHTML 저장, `--no-sandbox`와 `0.0.0.0` 기본값.

---

## 4. frontend-slides-editable

### 4.1 라이선스, 커밋, 유지보수

- 라이선스: MIT, `Copyright (c) 2026 LI ZHENG` (`LICENSE:1-3`). [소스]
- **상위 저작권 고지 누락.** frontend-slides의 포크이며(`README.md:100`, `:972`), 상위는 `MIT, Copyright (c) 2025 Zara Zhang`이다. [외부] 루트 `LICENSE`에는 상위 고지가 없다. [소스] 코드를 가져오려면 양쪽 고지를 모두 넣어야 한다. [추론]
- `beautiful-html-templates/LICENSE`: MIT, Zara Zhang. [소스] 포팅 템플릿 34종을 포함한다.
- 최근 커밋: 2026-07-01. 중단 공지 없음. 약 4개월간 커밋 없음. 이슈 트래커는 [미검증]. [소스]
- 서드파티 주의:
  - `scripts/extract-pdf.py`가 PyMuPDF에 의존한다(`:10`, `:26-28`). [소스] PyMuPDF는 AGPL/상용 이중 라이선스로 알려져 있다. [미검증] 제품에 포함하기 전에 확인해야 한다.
  - 저장 시 외부 폰트를 data URL로 내장한다(`examples/editable-deck-reference.html:2526-2560`). [소스] 폰트 재배포 조건은 폰트마다 확인이 필요하다. [미검증]

### 4.2 편집 저장 방식

**DOM 직렬화에 JSON 상태를 더한 방식이다. 원본 서식을 보존하지 않는다.** 줄 번호는 `examples/editable-deck-reference.html` 기준이다. [소스]

- `serializeSlidesRoot`: `clone.innerHTML` (`:2410-2414`)
- `buildStandaloneHtml`: `'<!DOCTYPE html>\n' + clone.outerHTML` (`:2676-2695`)
- 덱 내용을 `#deck-persisted-state` JSON에 한 번 더 넣는다(`:2481-2496`). 파일에 슬라이드 내용이 이중으로 저장된다. [추론]
- 로드 시 localStorage와 내장 상태 중 최신 것을 골라 `parent.innerHTML`로 전체를 교체한다(`:2460-2464`, `:2803-2811`).
- 저장 시 외부 자산이 바뀐다. 미디어와 폰트를 인라인하고, 실패한 폰트 링크는 제거하며(`:2557-2559`), 경고는 콘솔에만 남는다(`:2794`).

**임의 HTML을 가져오는 기능이 없다.** 런타임을 덱에 복사해 넣는 생성 시점 패턴이며, `.slides-offset`, `section.slide[id]`, `data-slide-object`, `data-edit-slot` 계약이 필요하다(`editor-runtime.md:29-62`). "Mode C"는 AI 에이전트가 파일을 고치는 절차다(`SKILL.md:164`). 즉 `plan.md:35`의 "임의 HTML 보장 범위"는 **보장 없음**이다. [소스]

### 4.3 격리와 보안

**iframe이 없다.** 편집기 런타임과 덱 스크립트가 같은 전역에서 실행된다. 레퍼런스 파일에서 `<iframe`, `sandbox`, `postMessage`, `DOMPurify`가 검색되지 않는다. [소스]

| #   | 약점                                                                                                                                                                                                                                | 근거                                                                | 수준                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------- |
| 1   | **검증 없는 `innerHTML` 복원.** `sanitizeEditableState`는 이름과 달리 UI 상태 정리일 뿐 보안 정제가 아님. 검증 스크립트는 이를 "sanitizer"로 요구함                                                                                 | `:2395-2408`, `:2464`, `scripts/validate-template-ports.py:336-337` | [소스]                    |
| 2   | **localStorage 오염과 키 충돌.** 키가 `editable-deck:` + `data-deck-id`이고 기본값은 `default`. 같은 출처의 덱끼리 충돌하며, revision이 더 큰 초안이 덱 전체를 대체함. 공용 호스팅에서는 다른 덱의 내용 교체나 스크립트 주입이 가능 | `:842`, `:2448-2458`, `:2803-2811`                                  | 코드 [소스] / 악용 [추론] |
| 3   | 저장 시 임의 `src`로 fetch 수행                                                                                                                                                                                                     | `:2510-2517`, `:2538-2545`                                          | [소스]                    |
| 4   | 텍스트 붙여넣기 처리 없음. 이미지 외에는 브라우저 기본 동작에 맡김                                                                                                                                                                  | `:3003-3007`                                                        | [소스]                    |
| 5   | 폐기 예정 API `document.execCommand` 사용                                                                                                                                                                                           | `:2071`                                                             | [소스]                    |

잘한 점: 내장 JSON의 `<`를 `\u003c`로 이스케이프해 `</script>` 탈출을 막는다(`:2495`). [소스]

### 4.4 PPTX와 PDF

- **PPTX와 PDF 내보내기가 없다.** README의 "PPT/PDF 변환"은 입력 방향이다. `scripts/extract-pptx.py`(python-pptx), `scripts/extract-pdf.py`(PyMuPDF)로 내용을 뽑아 HTML을 새로 생성한다(`README.md:168`, `:341`, `:357`). 레퍼런스에 `window.print`와 `@media print`가 없다. [소스]
- 서버 의존성은 없다. 저장은 File System Access API와 다운로드 폴백을 쓴다(`:2707-2741`). [소스]

### 4.5 테스트, 빌드, 규모

- 테스트: Python 스크립트 기반이다. [소스]
  - 정적 계약 `validate-editable-decks.py`, `validate-template-ports.py`
  - 깨진 픽스처가 실패하는지 보는 `test-editable-contract-fixtures.py`
  - 헤드리스 Chrome 스모크 `smoke-editable-decks.py`
  - CI는 없음(`.github` 없음)
- 자체 품질 문서가 한계를 인정한다. 스모크를 통과해도 `overflow:hidden`이 문제를 가려, 46개 프리셋 중 **15개에서 편집 슬롯이 슬라이드 밖에 있다**(`docs/quality-improvement-plan.md:22`, `:259`). 현재 수치는 [미검증]. [소스]
- 잠금 파일: `package-lock.json` v3이 있으나 `puppeteer-core`용뿐이다. Python 의존성 고정 파일은 없다. [소스]
- 규모: 런타임 3,621줄(139,905바이트)이 **덱마다 복사**된다. `swiss-modern.html`이 158,867바이트다. 런타임 버그를 고치면 모든 생성 덱을 다시 만들어야 한다. Python 7,556줄. [소스]

### 4.6 재사용하거나 배울 것

코드보다 **패턴**의 가치가 크다.

| 대상                                               | 내용                                                                                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `editor-runtime.md:48-62`                          | **슬롯과 객체 분리.** 내용만 편집하는 슬롯과 이동 가능한 객체를 나누고, Unlock layout을 명시적 동작으로 둠. L1/L2 경계와 잘 맞음 |
| `reference:2707-2717`, `:2789`                     | **사용자 제스처 보존.** 비동기 빌드 전에 `showSaveFilePicker`를 먼저 호출. 저장 구현에 바로 쓸 수 있음                           |
| `reference:1329`, `editor-runtime.md:124`          | `_positionPct`: `getComputedStyle`이 px을 돌려주어 드래그 시작 때 튀는 문제 회피                                                 |
| `editor-runtime.md:146-151`                        | 스냅 규칙. 슬라이드 외곽은 스냅 대상에서 제외                                                                                    |
| `editor-runtime.md:157-160`, `:188`                | RTE 포커스 처리. 네이티브 `select` 대신 버튼 + `mousedown preventDefault`                                                        |
| `editor-runtime.md:35`                             | 썸네일 복제본이 `querySelectorAll`에 잡히는 문제와 `:scope` 해법                                                                 |
| `reference:2495`                                   | 내장 JSON 이스케이프                                                                                                             |
| `README.md:528-530`, `quality-improvement-plan.md` | 경계 스모크와 사유 필수 `data-bounds-exempt`. 통과가 곧 안전은 아니라는 교훈                                                     |

**따라 하면 안 되는 것:** 덱마다 런타임 복사, 저장 시 전체 재직렬화, 공유 localStorage를 진실 원본 후보로 두는 방식.

---

## 5. Slidewright

### 5.1 정체 확인

**"Slidewright"라는 이름의 HTML 슬라이드 시각 편집기는 찾지 못했다.** 웹 검색 2회의 결과다. [외부] 후보는 둘이며 어느 쪽도 해당하지 않는다.

| 후보                   | 실체                                                                                                                                                                                                                | 근거                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| arifszn/slide-wright   | 덱을 생성하고 고치는 **에이전트 스킬**과 내보내기 CLI. 시각 편집 UI 없음. `contenteditable`, `outerHTML`, `sandbox`가 저장소 전체에서 검색되지 않음. "edit in place"는 에이전트가 파일을 고친다는 뜻(`SKILL.md:25`) | [소스]                                                 |
| mgritzbach/slidewright | 네이티브 PPTX를 만드는 **Codex 플러그인 + 레이아웃 컴파일러**. HTML 편집기가 아님. MIT, 최근 커밋 2026-07-20. 같은 검색어로 코드 검색 시 결과 없음                                                                  | [소스]. README와 파일 목록만 확인, **상세 감사 안 함** |

Peerlist 소개 페이지는 HTTP 403으로 원문을 읽지 못했다. 이후 내용은 HTML을 입력으로 쓰는 arifszn/slide-wright를 기준으로 한다.

검색에서 실제 시각 편집기로 보이는 프로젝트가 함께 나왔다. **이번 실사 범위 밖이며 전혀 확인하지 않았다** [미검증]: slides-grab(vkehfdl1), Starry Slides(StarryKit), slide-editor(kgraph57, GrapesJS 기반), b6+ editor(W3C). 경쟁 분석 목적이라면 이쪽이 Slidewright보다 관련성이 높을 수 있다.

### 5.2 라이선스, 커밋, 유지보수

- 라이선스: MIT, `Copyright (c) 2026 Ariful Alam` (`LICENSE:1-3`). [소스]
- 최근 커밋: 2026-10-24. 최근 코드 변경은 2026-10-15 무렵이고 이후는 문서 변경이다. 중단 공지 없음. [소스]
- 의존성: `pptxgenjs@4.0.1`, `playwright-core@1.64.1`을 첫 실행 시 사용자 캐시에 설치한다(`slide-wright/scripts/lib/deps.mjs:9-12`, `:19-33`). 덱은 CDN의 `reveal.js@5.1.0`을 쓴다(`references/deck-template.md:5`, `:164`). [소스]

### 5.3 편집 방식, 격리

- **편집 코드가 없다.** 사람이 조작하는 편집기가 없으므로 DOM 직렬화나 패치 비교의 대상이 아니다. 서식 보존 여부는 에이전트에 달려 있다. [소스]
- **격리 대상인 편집기 iframe이 없다.** [소스]
- 내보내기 CLI의 보안 [소스]:
  - 덱을 `file://`로 열어 JS를 실행한다(`export-pptx.mjs:64`).
  - 네트워크 제한은 없다. `route` 훅은 테스트에서만 쓴다(`:63`, `tests/lib/offline.mjs`).
  - Reveal 동작에 의존하므로 JS를 끌 수 없다(`:65`).
  - Playwright의 기본값이 Chromium 샌드박스 비활성으로 알려져 있으나 [미검증], 신뢰할 수 없는 덱을 다룬다면 명시 설정이 필요하다.
- 공급망 [소스]: 직접 의존성은 고정했지만 전이 의존성 잠금이 없다. `req('jszip')`는 `PINNED`에 없는 전이 의존성이다(`export-pptx.mjs:149`, `deps.mjs:9-12`).

### 5.4 PPTX와 PDF

- **PPTX는 하이브리드다.** 배경은 텍스트를 지운 슬라이드 스크린샷이고(`export-pptx.mjs:110-114`), 텍스트는 **네이티브 텍스트 상자**이며(`:115-141`), 발표자 노트도 포함한다(`:142`). [소스]
- 도형, 차트, SVG, 이미지는 배경에 합쳐져 편집할 수 없다(`README.md:97`, `references/export-pptx.md:9`). 즉 "완전 네이티브"는 아니다. [소스]
- 라이브러리: `pptxgenjs@4.0.1` + Playwright. [소스]
- PDF: 자동화가 아니라 `?print-pdf` + 수동 브라우저 인쇄다(`references/export-pdf.md:7-23`). [소스]
- 서버 의존성: 없음. 다만 **Node와 Chrome이 필요한 CLI**이며 브라우저 안에서 동작하지 않는다. CDN이 막히면 실패한다(`export-pptx.mjs:65-67`). [소스]
- **reveal.js 전용이다.** `window.Reveal`이 없으면 실패한다(`export-pptx.mjs:65-67`). 임의 HTML에 쓰려면 슬라이드 탐색 부분을 바꿔야 한다. [소스]
- 텍스트 위치는 LibreOffice 기준으로만 시험했고 PowerPoint 실물 확인은 사용자에게 요청한다(`references/export-pptx.md:32`). [소스]

### 5.5 테스트, 빌드, 규모

- **세 프로젝트 중 테스트 품질이 가장 높다.** [소스]
  - `tests/export-pptx.test.mjs` 40건, `tests/check-deck.test.mjs` 2건 (`test(` 선언 기준 grep 집계)
  - 독립 OOXML 구조 검증기(`tests/lib/validate-ooxml.mjs`)
  - 픽셀 기반 고스트 텍스트 검사와, 그 검사가 실제로 잡아내는지 보는 **대조 시험**(`export-pptx.test.mjs:166-181`)
  - LibreOffice 렌더 위치 시험(`:191`, `:239`, `:327`)
  - 오프라인 CDN 대체(`tests/lib/offline.mjs`)
- CI: GitHub Actions, Node 22, LibreOffice와 poppler 설치(`.github/workflows/test.yml`). [소스]
- 잠금 파일: 없음. 위 공급망 항목 참고. [소스]
- 규모: 스크립트 668줄, 테스트 코드 659줄, 픽스처 270줄. [소스]

### 5.6 재사용하거나 배울 것

**이번 실사에서 가장 재사용 가치가 높다.** `plan.md:195`의 "하이브리드(후속 검토)"가 실현 가능하다는 근거가 된다. 다만 실제 동작은 아직 시험하지 않았다.

| 대상                                                   | 내용                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/lib/extract.mjs` (301줄)                      | **핵심.** Range 클라이언트 사각형으로 텍스트 줄을 측정하고, CSS 런을 PPTX 런으로 변환함. 충실하게 놓을 수 없는 텍스트(변형, 그라디언트, 잘림, 가려짐)는 `skippedText`에 사유와 함께 남기고 이미지에 둠. 실패해도 원본 모습이 유지되는 구조임 (`:57-63`, `:150-154`, `:171-184`) |
| `extract.mjs`의 `skippedText`                          | `plan.md:72`의 "요소별 손실 보고"에 그대로 대응함                                                                                                                                                                                                                               |
| `export-pptx.mjs:16-23`                                | 텍스트 숨김 CSS. `-webkit-text-fill-color: transparent`와 `transition:none` 이유가 주석에 있음. 하위 요소 색 고정은 `extract.mjs:276-285`                                                                                                                                       |
| `scripts/lib/package.mjs` (31줄)                       | **pptxgenjs 출력 교정.** 없는 파트의 Override 제거, `xml:space="preserve"`, 중복 `<a:pPr>` 제거. `<p:presentation>` 자식 순서를 고치면 PowerPoint가 파일을 거부한다는 경고 포함                                                                                                 |
| `tests/lib/validate-ooxml.mjs`, `tests/lib/pixels.mjs` | PPTX 품질 검증 도구. 도입 권장                                                                                                                                                                                                                                                  |
| `scripts/check-deck.mjs`                               | 넘침, 잘림, 겹침, 폰트 미로드 검사. 가져오기 보고서에 응용 가능                                                                                                                                                                                                                 |

이식 시 고칠 점 [소스 + 추론]:

- Reveal 결합 제거(`export-pptx.mjs:69-78`, `:95-104`)
- 1920 기준과 scale 1 전제 처리(`:109`)
- `<aside class="notes">` 전제 일반화(`extract.mjs:287-297`)
- 배경 스크린샷이 Playwright 전제임. **순수 브라우저에는 정밀 스크린샷 API가 없으므로**, 브라우저 내 처리와 선택적 로컬 CLI 중 어느 쪽에 둘지 결정해야 함. `plan.md:192`의 Playwright 경로와 일치함

---

## 6. 권고 상세

### 6.1 선택지 판단

| 선택지                        | 판단     | 이유                                                                                                               |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| NextPPT 포크                  | **기각** | 저장, 격리, PPTX 세 축을 모두 다시 써야 함. 남는 것은 UI 껍데기와 랜딩 페이지이고 여기에 라이선스 정리 부담이 붙음 |
| frontend-slides-editable 포크 | **기각** | 임의 HTML 가져오기가 없고, 내보내기도 없으며, 런타임이 덱에 복사되는 구조가 제품 형태와 다름                       |
| slide-wright 포크             | **기각** | 편집기가 아니므로 포크 대상이 아님. 내보내기 부분만 선별 이식                                                      |
| **독자 개발 + 선별 재사용**   | **채택** | 핵심 차별점인 원본 보존과 격리는 어차피 새로 만들어야 하고, 내보내기와 검증은 검증된 구현을 활용할 수 있음         |

### 6.2 구성 요소별 조치

| 구성 요소            | 조치                                                                                                          | 출처                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 원본 보존 패치 엔진  | **독자 개발**                                                                                                 | 해당 구현 없음                    |
| 미리보기 격리        | **독자 개발.** 스크립트와 same-origin을 동시에 허용하지 않음. 파일 핸들과 같은 출처에 덱을 두지 않음          | NextPPT 반면교사                  |
| 슬라이드 탐지        | 규칙과 테스트 이식, 탐지 전용으로 수정                                                                        | NextPPT `normalizeDeck`           |
| 슬롯/객체 편집 모델  | 개념 채택                                                                                                     | frontend-slides-editable          |
| 저장 UX              | 제스처 보존, 원본 덮어쓰기 금지, 백업                                                                         | frontend-slides-editable, NextPPT |
| PPTX 편집/하이브리드 | `extract.mjs`, `package.mjs` 이식                                                                             | slide-wright                      |
| PPTX 외관 우선       | `pptxgenjs` 이미지 삽입. 구현이 단순해 직접 작성                                                              | NextPPT 구조 참고                 |
| PPTX 품질 시험       | OOXML 검증기, 픽셀 시험, 대조 시험 이식                                                                       | slide-wright                      |
| npm 패키지           | `pptxgenjs` 직접 사용. 버전은 4.x를 검토(`package.mjs` 교정이 4.0.1 기준). 필요 시 `pdf-lib`, `html-to-image` | 세 프로젝트의 사용 사례           |

이식할 때는 각 파일의 MIT 고지를 유지하고 `THIRD_PARTY_NOTICES`를 둔다. frontend-slides-editable에서 코드를 가져오면 LI ZHENG과 Zara Zhang 고지가 모두 필요하다.

### 6.3 Phase 0에서 이어서 검증할 항목 (설계 제안)

1. **원본 위치 기반 패치 스파이크.** `parse5`의 소스 위치 정보로 바이트 범위 패치가 가능한지 확인한다. 세 프로젝트 어디에도 선례가 없으므로 **이 프로젝트 최대의 기술 위험이다.** 도구 선택은 [미검증]이다.
2. **슬라이드 탐색 어댑터.** `extract.mjs`를 Reveal 없이 임의 덱에서 돌릴 수 있는지 시험한다.
3. **브라우저 내 래스터화.** `html-to-image` 결과와 Playwright 스크린샷의 차이, 그리고 텍스트 숨김 CSS가 그 경로에서 동작하는지 측정한다. [미검증]
4. **PowerPoint 실물 확인.** slide-wright도 LibreOffice까지만 시험했다.

---

## 7. 검증하지 못한 것

| 항목                                              | 상태                                                                            | 조치                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| NextPPT 실제 실행 및 왕복 시험 (`plan.md:48`)     | **미수행.** 실행 금지 규칙 때문. 3장의 손실과 취약점은 코드 경로 분석 결과임    | 필요하면 격리 환경에서 별도 수행. 스크립트 소실, 폴더 자산 404, 핸들 접근 PoC부터 |
| 잠금 버전 기준 busboy/multipart 동작              | `main` 브랜치 원문만 확인                                                       | 재현 시험 시 확인                                                                 |
| `LiquidEther.tsx`와 React Bits의 동일성           | 이름만 일치                                                                     | 코드를 재사용하지 않으면 불필요                                                   |
| PyMuPDF, Playwright 기본값, 폰트 재배포 조건      | 일반 지식 수준                                                                  | 해당 기능 도입 시 확인                                                            |
| GSAP 조항 적용 여부                               | 조항만 조회, 웹 조회 도구의 요약을 통해 읽음. 법률 판단 아님                    | GSAP을 쓰지 않으면 불필요                                                         |
| 저장소 이슈와 PR 현황                             | 확인 안 함                                                                      | 유지보수 판단 보강 시                                                             |
| Windows에서의 NextPPT 동작                        | 확인 안 함. 실행 파일 경로는 macOS와 Linux만 하드코딩(`screenshotter.ts:36-42`) | 재현 시험 시                                                                      |
| mgritzbach/slidewright 상세, 기타 시각 편집기 4종 | 미감사                                                                          | 경쟁 분석 또는 네이티브 PPTX 참고가 필요할 때                                     |

얕은 클론이므로 NextPPT와 slide-wright의 전체 커밋 수는 알 수 없다. slide-wright의 80커밋은 병합 이력 때문에 깊이 50을 넘겨 집계된 값이다. [소스]

클론 위치(검토 후 삭제 가능):
`C:\Users\User\AppData\Local\Temp\claude\D--Google-Drives-DEV-html-ppt-editor\65115b09-86c9-4d72-bfab-219088284706\scratchpad\oss\`

## 8. 외부 출처

- [NextPPT](https://github.com/Trade-Offf/NextPPT)
- [frontend-slides-editable](https://github.com/archlizheng/frontend-slides-editable)
- [frontend-slides LICENSE](https://raw.githubusercontent.com/zarazhangrui/frontend-slides/main/LICENSE)
- [arifszn/slide-wright](https://github.com/arifszn/slide-wright)
- [mgritzbach/slidewright](https://github.com/mgritzbach/slidewright)
- [Peerlist Slidewright 소개](https://peerlist.io/arifszn/project/slidewright) (HTTP 403, 검색 요약만 확인)
- [Devpost slidewright](https://devpost.com/software/slidewright) (검색 결과로만 확인)
- [fastify/busboy multipart.js](https://raw.githubusercontent.com/fastify/busboy/main/lib/types/multipart.js)
- [fastify-multipart index.js](https://raw.githubusercontent.com/fastify/fastify-multipart/main/index.js)
- [GSAP Standard License](https://gsap.com/standard-license/)
- [React Bits LICENSE](https://raw.githubusercontent.com/DavidHDev/react-bits/main/LICENSE.md)
- 검색 결과로만 확인: [slide-editor](https://github.com/kgraph57/slide-editor), [Starry Slides](https://github.com/StarryKit/starry-slides/wiki), [slides-grab](https://www.sourcepulse.org/projects/27165882), [b6+ editor](https://www.w3.org/Talks/Tools/b6plus-editor/)
