# HTML-PPT Studio (작업명)

AI가 이미 만들어 준 HTML 발표자료, 글자 하나 때문에 다시 생성하지 마세요.

HTML 발표자료를 브라우저에서 열어 글자와 사진을 고치고, 원본 디자인을 유지한 채 다시 저장하거나 PDF·PPTX로 내보냅니다. 파일은 서버로 전송되지 않고, 파일 안의 스크립트는 실행되지 않습니다.

[English](README.md)

**바로 써 보기:** https://leondic1976.github.io/html-ppt-editor/ (정적 페이지이며 파일은 브라우저 안에만 있고 업로드되지 않습니다)

## 할 수 있는 일

- **기존 HTML 수정 (L1):** 글자, 사진, 일부 서식을 고칩니다. 고치지 않은 부분은 바이트 단위로 원본과 같습니다.
- **요소로 변환 (L2) / 그림으로 고정 (L3):** 위치까지 옮기고 싶다면 변환합니다. 변환으로 달라지는 점은 보고서에 나옵니다.
- **새 문서 작성:** 텍스트, 사진, 도형, 선, 표, 차트, 코드, SVG를 넣고 편집합니다.
- **보안 검사:** 파일을 열기 전에 악성 패턴을 정적으로 검사합니다. [검사의 한계](#보안-검사의-한계)를 함께 읽어 주세요.
- **내보내기:** 단일 HTML(오프라인 발표 가능), 발표 전용 HTML, 브라우저 인쇄로 PDF, PPTX(편집 우선 / 외관 우선).
- **발표:** 전체 화면, 발표자 보기(노트·타이머·다음 슬라이드).

## 시작하기

Node.js 22 이상과 pnpm이 필요합니다.

```sh
pnpm install
pnpm dev          # http://localhost:5173
pnpm build        # apps/editor-web/dist 에 정적 파일 생성
```

명령줄 도구:

```sh
pnpm scan <파일> [--json]         # 보안 검사. 종료 코드 0 / 1 의심 / 2 위험
pnpm deck-to-pdf <deck.html>      # 텍스트가 선택되는 PDF 파일 (Chrome 필요)
pnpm schema                       # docs/schema-v2.json 재생성
```

## 보안 검사의 한계

이 검사는 **백신이 아닙니다.** 파일을 실행하지 않고 알려진 패턴을 찾는 정적 분석입니다. 실행 파일 위장, HTML 스머글링, 난독화, 암호화폐 채굴기, 피싱 폼, 키로거, ClickFix 같은 수법을 찾지만, 새로운 악성코드나 교묘하게 숨긴 코드는 놓칠 수 있습니다. 그래서 어떤 결과도 "안전함"으로 표시하지 않습니다. 가장 좋은 결과가 "알려진 위협 미탐지"입니다.

보호의 중심은 검사가 아니라 격리입니다. 검사를 통과하든 못 하든 파일의 스크립트는 이 앱에서 실행되지 않습니다. 다만 **저장한 HTML에는 원본 스크립트가 그대로 남습니다.** 믿을 수 없는 파일을 브라우저로 직접 열지 마세요. 자세한 내용은 [THREAT_MODEL.md](THREAT_MODEL.md)에 있습니다.

## 지원 범위

100% 자동 변환을 약속하지 않습니다. 무엇이 편집 가능하고 무엇이 그림으로 고정되는지 가져오기·내보내기 때 알려 드립니다. 자세한 내용은 [COMPATIBILITY.md](COMPATIBILITY.md), [docs/import-limitations.md](docs/import-limitations.md), [docs/export-fidelity.md](docs/export-fidelity.md)를 보세요.

## 문서

- [ARCHITECTURE.md](ARCHITECTURE.md): 구조와 패키지 경계
- [docs/phase0/G0-report.md](docs/phase0/G0-report.md): 기술 검증 결과와 아직 확인하지 못한 항목
- [docs/decisions/](docs/decisions/): 설계 결정 기록(ADR)
- [docs/schema-v2.md](docs/schema-v2.md): 문서 형식
- [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md)

## 이름에 대하여

"HTML-PPT Studio"는 내부 작업명이며, 공개 전에 바꿀 예정입니다. 상표·패키지·도메인 가용성은 아직 확인하지 않았습니다.

## 라이선스

[MIT](LICENSE)
