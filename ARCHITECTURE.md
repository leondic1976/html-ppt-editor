# 구조

## 두 가지 편집 모드

```
                   ┌───────────────────── 열기 ─────────────────────┐
  파일 ─ 바이트 검사 ─ 보안 스캔(Worker) ─┬─ 앱이 저장한 HTML / JSON / MD ─→ 네이티브 모드
                                         └─ 그 외 HTML ─────────────────→ 레거시 모드

  네이티브: 문서 모델(JSON) ─ commands/history ─ slide-renderer ─ 캔버스·썸네일·발표·인쇄·HTML
                                                 └ export-pptx ─ PPTX
  레거시:   원본 텍스트 + Patch Journal ─ 바이트 범위 치환 ─ 저장본
            └ 살균 복사본 ─ 샌드박스 iframe (미리보기)
            └ 계산된 스타일 읽기 ─ L2/L3 변환 ─ 네이티브 모드 / PPTX
```

레거시 모드는 HTML을 다시 직렬화하지 않습니다. `parse5`의 소스 위치로 고칠 범위를 찾아 그 부분만 바꾸므로, 나머지는 줄바꿈과 주석까지 원본과 같습니다.

## 패키지

| 패키지               | 역할                                                  | 의존해도 되는 것                  |
| -------------------- | ----------------------------------------------------- | --------------------------------- |
| `document-core`      | 스키마(Zod), 명령, 실행 취소, 마이그레이션, 단위 변환 | 없음 (DOM·React 금지)             |
| `slide-renderer`     | 모델 → HTML 문자열. 모든 화면과 출력이 공유           | `document-core` (React 금지)      |
| `interaction`        | 선택·이동·크기·스냅·정렬 계산                         | 없음                              |
| `security-scan`      | 정적 악성 패턴 검사, 인코딩 판별                      | 없음 (`parse5`만)                 |
| `import-legacy-html` | 슬라이드 탐지, 패치, 미리보기 살균, L2/L3             | `document-core`, `security-scan`  |
| `import-md-json`     | Markdown, JSON, 공개 스키마                           | `document-core`                   |
| `asset-manager`      | 이미지 검증, IndexedDB 기록, 파일 저장                | `document-core`, `security-scan`  |
| `export-html`        | 단일 HTML, ZIP, 읽어 들이기                           | `document-core`, `slide-renderer` |
| `export-pptx`        | PPTX 변환. 앱 상태를 읽지 않고 어댑터만 받음          | `document-core`, `export-report`  |
| `export-pdf`         | 브라우저 인쇄                                         | 없음                              |
| `export-report`      | 손실·경고 공통 형식                                   | 없음                              |
| `design-system`      | 메뉴 문자열, 글꼴 목록                                | 없음                              |
| `apps/editor-web`    | React UI                                              | 전부                              |

규칙은 `scripts/check-boundaries.mjs`가 CI에서 검사합니다.

plan.md의 구조와 다른 점이 있습니다.

- `apps/demo`와 `apps/export-service`는 만들지 않았습니다. 데모는 `editor-web` 빌드를 GitHub Pages에 올립니다(`.github/workflows/pages.yml`). 서버 PDF 대신 로컬 명령 `scripts/deck-to-pdf.ts`를 제공합니다. 파일을 서버로 보내지 않아도 되기 때문입니다.
- `security-scan`은 plan.md에 없던 패키지로, 사용자 요청으로 추가했습니다.

## 신뢰 경계

가져온 파일은 끝까지 데이터입니다. 자세한 내용은 [THREAT_MODEL.md](THREAT_MODEL.md)와 [ADR-008](docs/decisions/ADR-008-untrusted-content.md)을 보세요.

- 미리보기는 살균한 복사본을 `sandbox="allow-same-origin"` iframe에 넣습니다. `allow-scripts`가 없어 그 안의 코드는 실행되지 않습니다. 편집기는 부모 쪽 코드로 그 DOM을 다룹니다.
- 앱이 저장한 파일을 다시 열 때도 JSON을 스키마로 검증하고 자산 해시를 확인합니다. 파일의 스크립트는 읽지도 실행하지도 않습니다.

## 좌표

모델 좌표는 슬라이드에 정규화한 논리 픽셀이고, 줌은 CSS `transform`으로만 적용합니다. 인치·포인트 변환은 `document-core/src/units.ts` 한 곳에만 있습니다(1920폭 기준 144 model-px = 1인치).
