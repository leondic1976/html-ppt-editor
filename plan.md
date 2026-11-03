HTML-PPT 웹 에디터 개발계획서 — 보완·통합판 v2.0
검토 기준일: 2026-11-02
프로젝트명: 미확정 (내부 작업명: HTML-PPT Studio)
목표: 기존 HTML 발표자료를 시각적으로 수정하고, 새 자료를 제작하며, 단일 HTML·PDF·PPTX로 전달하는 local-first 오픈소스 웹 에디터
문서 성격: 제품 요구사항(PRD) + 기술 설계(TRD) + 릴리스 기준 + 착수 전 검증 계획
작성 원칙: 확정 사실 / 설계 제안 / 검증 과제를 구분. 수치 목표는 초기 가정이며 G0 측정 후 확정.

0. 요약: 기존 계획의 방향을 어떻게 바꾸는가
문제 정의
기존 계획서는 새로운 슬라이드를 만드는 웹 편집기에 최적화되어 있으나, 최초 수요는 이미 AI 등으로 생성한 HTML-PPT를 불러와 파워포인트처럼 수정하는 것이다. 기존 HTML 가져오기를 v1.1로 미루면 가장 중요한 사용 사례를 출시 때 제공하지 못한다.
최종 제품 정의
“AI나 사람이 만든 HTML 프레젠테이션을 바로 열어 고치고, 필요하면 처음부터 제작하고, 원본 디자인을 최대한 유지하면서 HTML·PDF·PPTX로 전달하는 오픈소스 브라우저 에디터.”
우선순위 변경 사항
구분	기존 계획	보완한 결정
첫 번째 사용 사례	새 문서 생성	기존 HTML-PPT 열기 → 글자·사진 교체 → 다시 저장
HTML 가져오기	v1.1	Phase 0~1부터 읽기/미리보기/안전한 텍스트 수정; 점진적으로 레이어 변환
편집 원리	절대좌표 요소 모델 하나	이중 편집 엔진: (A) 네이티브 슬라이드 모델, (B) 기존 HTML 호환 모드
저장 충실도	HTML 100% 재현 주장	원본 정밀도·편집성·호환성의 상충관계 측정 및 경고
PPTX	가능한 요소 네이티브, 나머지 이미지	편집 우선 / 외관 우선 2가지 출력 모드 제공
PDF	브라우저 인쇄 = PDF 출력	브라우저 인쇄와 다운로드되는 PDF 파일 생성을 별개의 기능으로 표시
보안	DOMPurify + iframe	파일 신뢰 등급, 정적 변환, 별도 격리, 네트워크 차단 정책, 로컬 파일 위협 모델
프로젝트명	Deckwright	사용 중인 DeckWright가 확인되어 신규 명칭 필요
공개 전략	기능 많은 v1.0	기존 HTML 편집 문제를 확실히 해결하는 v0.x → 안정된 v1.0


범위에 관한 세 가지 정직한 약속
1. 네이티브 형식으로 만든 자료는 글자·도형·사진·표를 편집할 수 있게 유지한다.
2. 외부에서 임의로 작성한 HTML은 구조별로 편집 가능성이 다르다. 100% 자동 변환·100% 네이티브 PPTX 편집 가능은 약속하지 않는다.
3. 사용자에게 무엇이 편집 가능하고, 무엇이 이미지로 고정되며, 어떤 디자인 속성이 달라지는지 가져오기·내보내기 전후에 알려준다.
1. 제품 및 경쟁 프로젝트 조사
1.1 선행 프로젝트 (2026-11-02 공개 자료 기준)
프로젝트	확인된 기능 또는 성격	시사점
DeckWright (이미 사용 중인 이름)	HTML 프레젠테이션의 발표자 화면, 오프라인 실행, PDF/PPTX 백업 출력	동일 프로젝트명 사용 회피. 이름만 바꾸면 해결되는 사안이 아니므로 브랜드 검색·상표 검토는 별도 수행
NextPPT (MIT)	AI 생성 HTML의 클릭 편집, 요소 이동, 로컬 HTML/PDF/PPTX 변환. 공개 README에 운영·유지보수 중단 안내	참조·포크 후보. 다만 이미지 기반 PPTX 출력 중심인지 실제 편집 가능한 객체인지 소스 검증 필요
frontend-slides-editable (MIT)	단일 파일에 편집 런타임, 드래그·크기 변경·슬라이드 순서·이미지 교체	임베디드 편집기 패턴 참조. 기존 임의 HTML에 대한 보장 범위는 별도 분석
Slidewright 등 기타 프로젝트	HTML 슬라이드 시각 편집 도구 사례	기술 재사용·중복 개발 여부 조사


참조 링크
- DeckWright: https://sangmin.me/software.html
- NextPPT: https://github.com/Trade-Offf/NextPPT
- frontend-slides-editable: https://github.com/archlizheng/frontend-slides-editable
1.2 차별화 전략
“HTML을 편집하고 PPTX를 만든다”만으로는 차별성이 충분하지 않다. 출시 메시지는 **“기존 HTML 발표자료의 시각적 편집 + 편집성 표시 + 외관/편집성 선택형 PPTX + 확실한 오프라인 저장”**으로 좁힌다.

지속 가능성을 위한 최초 대상은 HTML-PPT를 자주 생성·수정하는 AI 활용자, 개발자, 강의·보고자료 제작자다. 초기에는 계정·클라우드 공유·AI 생성 구독 기능보다 파일을 다시 만들지 않고 수정할 수 있는 시간 절감을 앞세운다.
1.3 Phase 0 필수 오픈소스 실사
- NextPPT를 설치해 실제 사용 중인 HTML 3종으로 글자 수정→저장→재열기→PPTX 출력까지 재현한다.
- HTML DOM 패치 방식, 화면 캡처 방식, 외부 서버 의존성, 브라우저 지원, 파일 다운로드 방식을 소스에서 확인한다.
- 라이선스 파일·서드파티 라이선스·최근 커밋·테스트 구조·빌드 재현성을 검사한다.
- 독자 개발 / 특정 패키지 재사용 / 포크 중 하나를 기술 검증 결과로 선택한다. 기존 프로젝트의 코드를 무조건 포크하지 않는다.
2. 사용자 시나리오와 출시 판정
시나리오 A — 기존 AI 생성 HTML 수정 (최우선)
1. 사용자가 기존 발표자료 .html 파일을 끌어다 놓는다.
2. 앱이 파일 구조와 슬라이드를 인식하고, 정확 편집 / 제한 편집 / 미리보기 전용 영역을 표시한다.
3. 사용자 선택에 따라 안전한 호환 모드로 열고, 슬라이드 13장의 문구를 수정하며, 사진 한 장을 교체한다.
4. 이전 배치를 가능한 한 유지한 채 미리보기에서 변경 전·후를 비교한다.
5. 편집 가능한 HTML로 저장을 누른 다음 같은 파일을 다시 열었을 때 수정 사항이 남아 있다.
6. PDF로 인쇄·저장하고, PPTX는 외관 우선 / 편집 우선 가운데 선택해 내보낸다.
시나리오 B — 처음부터 작성
새 문서 → 템플릿 선택 → 10장 작성 → 텍스트/이미지/도형/차트 편집 → 버전 저장 → 발표자 보기 → HTML/PDF/PPTX 출력 → 재열기.
시나리오 C — AI와 협업
LLM이 공개 JSON Schema에 따라 문서를 생성 → 스키마 검증·오류 표시 → 시각적 수정 → HTML로 전달. 원문 HTML 생성은 기존 HTML 가져오기 경로를 탄다.
v0.1/베타 출시 기준 (범위를 집중)
- 실제 기존 HTML 샘플 최소 3개 중 2개 이상에서 정적 텍스트 수정 및 HTML 왕복 저장 성공; 나머지는 이유와 대응 방법 제공.
- 새 문서에서 텍스트·사진·도형·선 요소를 생성하고 이동·삭제·실행취소 가능.
- 10장짜리 슬라이드 생성/재열기/전체화면 발표/브라우저 인쇄가 동작.
- 모든 미지원 가져오기 기능은 조용히 누락하지 않고 명시한다.
v1.0 출시 기준
- 목표 브라우저에서 정의된 핵심 E2E 전부 통과. 브라우저 기능에 따른 예상 폴백은 정상 동작으로 평가한다.
- 기존 HTML 유형별 편집 지원 매트릭스 공개.
- PPTX의 이미지 폴백 수·손실 속성·변환 실패 원인을 요소별로 출력.
- 독립 저장본 2회 재열기, 재편집 후 HTML 재저장 및 파일 무결성 검증.
- 3명 이상의 외부 테스터가 각자 실제 파일을 수정해 출력 성공; 테스트 문서와 이슈를 공개.
- 라이선스·보안 스캔·한/영 문서·데모를 준비.
3. 핵심 설계: 2가지 편집 모드
A. 네이티브 슬라이드 편집 모드
앱이 생성한 문서나 공개 스키마에 맞춘 JSON/HTML을 편집한다. 요소는 ID·좌표·크기·회전·순서·서식을 가지며 HTML 렌더러와 PPTX 변환기에 전달된다. 높은 편집성을 보장할 수 있는 모드다.
B. 레거시 HTML 호환 모드
임의 HTML은 유연한 DOM/CSS/flex/grid/SVG/JS를 포함할 수 있어 기계적으로 평면 절대좌표 객체로 변환하면 원본이 깨지기 쉽다. 따라서 다음의 3단계 편집 수준을 명시한다.
수준	UI 표시	수정 가능 범위	적용 시점
L1: 원본 보존 편집	원본 편집	정적 텍스트 교체, 이미지 URL/파일 교체, 일부 CSS 속성 편집. DOM 변경을 패치로 관리	v0.1 목표
L2: 구조화 변환 편집	요소 편집	제목·본문·이미지·SVG 도형·표 등을 추출해 레이어로 변환 후 이동·크기 조정	v0.x 단계적 추가
L3: 시각 보존 편집	화면 고정	원본을 이미지·SVG 배경으로 보존, 위에 새 요소 추가 및 수정. 원본의 개별 픽셀은 편집 불가	v0.1 폴백


가져오기 처리 순서
1. 확장자뿐 아니라 파일 내용/크기/인코딩/doctype/schema 마커를 검사한다.
2. 전용 문서 모델이 있으면 네이티브 모드로 스키마 검증 → 마이그레이션 → 열기를 실행한다.
3. 일반 HTML이면 script/URL/CSS/외부 자산/iframe을 탐지하고 신뢰 등급과 경고를 보여준다.
4. 정적 안전 미리보기 환경에서 슬라이드 컨테이너 후보(section.slide, [data-slide], 페이지 크기·overflow 패턴 등)를 찾는다.
5. 슬라이드 수·컨테이너 확신도·이미지 누락·폰트 누락을 표시한다. 사용자가 슬라이드 구획을 수동 지정할 수 있다.
6. 편집 후보 텍스트와 이미지를 DOM 노드 기준으로 식별한다. 식별 가능한 영역만 L1 패치로 편집한다.
7. L2를 요청할 경우 계산된 스타일과 레이아웃을 읽어 요소별 좌표·서식을 추출한다. CSS Grid/Flex 및 가상요소의 완전한 역변환은 보장하지 않는다.
8. 실패 요소는 L3 이미지로 고정하여 화면 보존과 편집성의 트레이드오프를 알린다.
9. 저장 시 원본 HTML 자체·편집 패치·가져오기 보고서를 보존한다. 재열기 후 변경 사항이 중복 적용되지 않아야 한다.
중요한 구현 조건: 레거시 HTML에 포함된 JS 코드를 일반 에디터 페이지에서 실행하지 않는다. 정적 HTML만 우선 지원하며 동적 차트/애니메이션은 미리보기용 이미지 폴백이 될 수 있다. 원본 JS 실행 모드는 v1.x의 고급·고위험 기능으로 분리하고, 별도 출처/격리/네트워크 정책 및 사용자 명시적 선택 없이는 활성화하지 않는다.
레거시 HTML 보존 전략
원본 바이트를 legacySource로 보관하고, 선택한 DOM 노드에 대해 안정적인 키(data-deck-edit-id 우선, 구조적 CSS selector + 원문 해시 폴백)를 만든다. 편집 변경을 Patch Journal로 기록한다. 저장 시 원본 복사본에 패치를 적용한 HTML을 생성한다. 패치 대상이 사라지거나 해시가 충돌하면 수동 해결 필요 상태로 표시하고 임의로 다른 노드를 수정하지 않는다. 기존 CSS를 네이티브 스키마로 덮어쓰지 않는다.
슬라이드 탐지의 실패 처리
슬라이드 구분을 찾지 못하면 임의로 페이지를 나누지 않는다. 전체 HTML을 한 장으로 열기, 구분자 선택, 원본 보기를 제공한다. 스크롤 문서는 PPT가 아니라 웹 페이지일 수 있음을 설명한다.
4. 사용자 인터페이스와 편집 상호작용
데스크톱 우선 레이아웃: 상단 제목·저장 상태·파일/편집/삽입/보기/발표/내보내기 메뉴, 좌측 슬라이드 목록, 중앙 캔버스(배율 및 눈금), 우측 속성·레이어·변환 경고 패널, 하단 상태 바(페이지·언어·선택 요소·변경 상태).
편집 필수 동작
- 클릭 선택 / Shift 또는 Ctrl 다중 선택 / 드래그 영역 선택, 선택된 대상의 경계 박스·조절점 표시.
- 드래그 이동, 8방향 크기 조절, 회전, 가로세로 비율 고정, 중심 기준 리사이즈, 키보드 1단위·10단위 이동.
- 안전 영역 표시, 스냅(슬라이드 중앙선·경계·다른 요소), 자동 정렬·분배, 겹침·잘림 경고.
- 더블클릭 텍스트 편집, 선택된 텍스트 스타일 툴바, 이미지 교체 및 cover/contain/crop·초점 위치 편집.
- 오른쪽 속성 패널에서 x/y/w/h/회전/불투명도/채우기/테두리/폰트/폰트 크기/줄간격/정렬/자간/그림자 수정.
- 그룹·잠금·z-order·레이어 검색, 슬라이드 복제·이동·섹션 구분, 노트 편집.
- undo/redo는 UI 선택 상태와 문서 변경을 구분하며, 텍스트 입력 여러 번을 하나의 논리적 변경으로 묶는다.
- 클립보드로 내보낸 자체 JSON MIME은 네이티브 복사/붙여넣기에 사용하고, 일반 텍스트·이미지 붙여넣기는 안전한 폴백을 사용한다.
- 키보드 충돌(브라우저 자체 Ctrl+D 책갈피 등)을 감지하며, 실제 동작은 브라우저·OS별로 테스트한다.
시각 디자인 품질을 위한 별도 기능
- 그라데이션(선형/방사형), 배경 이미지, 반투명 오버레이, 카드·그림자, 곡선/직선/연결선, SVG 로고, 자주 쓰는 레이아웃.
- 텍스트 스타일 프리셋(보고서·강의·제품 소개), 한글 줄바꿈·장평/자간의 처리 범위 명시.
- 슬라이드 내 콘텐츠 넘침 검사: 우측 경계, 하단 경계, 텍스트 상자 실제 높이, 이미지 넘침.
- 비교 보기: 저장 전과 후, 원본 HTML과 편집본, HTML 렌더 결과와 PPTX 렌더 결과.
- 수정 전 원본 보존은 저장 시 기본값. 자동 덮어쓰기 전에는 변경 사항과 대상 파일 확인.
5. 내부 문서 모델·버전 관리
주요 원칙
- 문서 포맷(JSON schema)은 UI 프레임워크와 독립적이다.
- formatVersion, appVersion, rendererVersion, docId, lastSavedAt, migrationHistory를 별도로 관리한다.
- ID는 중복되지 않는 안정 ID, 에셋은 해시 기반 ID를 사용한다. 파일 무결성 해시는 내용 검증용이며 악성코드 판별 수단이 아니다.
- 좌표·글꼴·패딩의 단위를 스키마에 명확히 선언한다(모델 좌표: 논리 px, 글꼴: 논리 px).
- 커스텀 HTML은 trustedHtml 같은 위험한 불리언으로만 처리하지 않고 권한·격리·실행 정책을 분리한다.
- 중요한 문서 속성은 특정 TipTap 버전에만 종속되지 않게 마이그레이션 어댑터를 둔다.
권장 JSON 뼈대 (예시, 최종 스키마 아님)
{
  "formatVersion": 2,
  "docId": "doc-example",
  "meta": { "title": "샘플 발표", "locale": "ko-KR" },
  "page": { "width": 1920, "height": 1080, "unit": "model-px", "ratio": "16:9" },
  "theme": {
    "fontFamily": "Pretendard",
    "fontFallback": ["Malgun Gothic", "Arial", "sans-serif"],
    "tokens": { "background": "#0f172a", "foreground": "#f8fafc", "accent": "#38bdf8" }
  },
  "assets": {
    "sha256-example": { "kind": "image", "mime": "image/png", "size": 1024, "source": "embedded" }
  },
  "slides": [
    {
      "id": "slide-1",
      "background": { "type": "solid", "color": "#0f172a" },
      "notes": "발표자 노트",
      "elements": [
        {
          "id": "el-1", "type": "text",
          "frame": { "x": 160, "y": 350, "w": 1600, "h": 170, "rotate": 0 },
          "zIndex": 1, "locked": false,
          "content": { "type": "doc", "content": [] },
          "style": { "fontSizePx": 100, "lineHeight": 1.1, "fontWeight": 700, "align": "center", "padding": 0 }
        }
      ]
    }
  ],
  "legacy": null
}
단일 HTML 출력 구조 결정
원본 포맷과 배포용 렌더링을 구별한다. 최종 .html에는 HTML/CSS, 모델 JSON, 필요한 실행 스크립트 및 임베드 가능한 에셋을 포함한다. 재편집은 JSON 기준으로 진행한다. 다만 파일 크기를 줄이기 위해 동일 이미지를 DOM·JSON에 무조건 두 번 base64 인코딩하지 않는다. 에셋 저장소의 단일 원본을 여러 슬라이드가 참조하도록 설계하고, 첫 렌더링 방식(미리 직렬화된 DOM 또는 런타임 렌더링)은 Phase 0의 실제 파일 크기·로딩 성능 결과로 선택한다.
- file://로 직접 열어 발표할 수 있어야 한다. 실행에 필요해 별도 서버를 요구하는 API는 사용하지 않는다.
- 편집기에서 다시 열기는 HTML 내 마커/모델이 있는 파일에 대해 보장한다. 임의 HTML은 레거시 경로로 연다.
- <script type="application/json"> 안에 직렬화할 때는 HTML 파서의 </script 종료 문제를 처리해야 한다. 단순 JSON.stringify 후 삽입 금지.
- 외부 CDN·폰트·이미지·iframe·영상 링크를 사용하면 완전 오프라인 파일이 아니다. 저장 옵션과 리포트에 외부 의존성을 표시한다.
- 임베드 폰트는 OFL 등 재배포가 허용된 파일에 한정하며 해당 라이선스 고지·폰트 이름 조건을 지킨다. Pretendard는 공식 저장소의 OFL 고지를 확인하고 사용한다.
- 자산 파일이 너무 커지면 HTML 단일 파일 모드 대신 HTML + assets ZIP을 선택하도록 한다. 20MB는 초기 경고 기준으로만 사용하고 실제 한계는 측정한다.
- 서명/해시를 사용할 경우 위변조 탐지용이지 신뢰 가능한 작성자 인증과 혼동하지 않는다. 인증 서명을 제공하려면 별도의 키 관리가 필요하다.
버전 히스토리·장애 복구
IndexedDB에 문서 스냅샷과 명령 패치를 구분 저장한다. 주기적 스냅샷과 용량 제한·오래된 기록 정리를 실시한다. 브라우저 저장소가 삭제되거나 쿼터를 넘을 수 있으므로 영구보존을 약속하지 않는다. 백업용 다운로드를 쉽게 제공하고, 저장 실패/쿼터 초과/파일 권한 취소는 명시적으로 알린다.
6. 동일 렌더러의 범위와 한계
core → renderer → 편집 캔버스 / 발표 / 썸네일 / 인쇄 HTML의 단방향 구조를 유지한다. 렌더러는 가능하면 UI 프레임워크에 비의존적으로 설계한다. 하지만 동일 렌더러를 사용해도 브라우저, 폰트 설치 여부, 인쇄 엔진, iframe, 캔버스 캡처, PPTX 처리에 따라 픽셀 단위 완전 동일이 자동 보장되는 것은 아니다.
렌더 일관성 계약
1. 편집용 선택 핸들과 가이드는 렌더 트리 바깥의 오버레이로 처리하여 출력에 포함하지 않는다.
2. 폰트 로딩 완료, 이미지 decode 완료, 애니메이션 정지, 브라우저 배율을 캡처 기준에 포함한다.
3. 1920×1080 논리 좌표와 실제 화면 표시 배율을 분리한다. 요소 데이터 좌표는 줌에 따라 변경하지 않는다.
4. HTML 렌더러는 CSS 스타일 안전 범위를 명시하고, PPTX로 매핑 불가능한 속성을 보고한다.
5. 화면·썸네일·출력별 시각 회귀 테스트를 동일한 CI 컨테이너 및 폰트 세트에서 실행한다.
좌표 및 글꼴 변환의 정확한 계약
16:9 슬라이드 13⅓×7.5인치로 만들면:
- x(in) = x(model-px) / 144;
- w(in) = w(model-px) / 144;
- fontSize(pt) = fontSize(model-px) × (72 / 144) = fontSize × 0.5;
- CSS의 통상 길이 정의 96 CSS px = 1 inch와 충돌하지 않도록 내부 모델 px는 슬라이드 전체 크기에 정규화된 논리 단위로 설명한다.
예컨대 슬라이드 화면에서 fontSizePx=100인 글자는 PPTX로 내보낼 때 50pt가 초기 목표이며, 실제 줄바꿈은 PPT 렌더러에 따라 달라질 수 있다. 텍스트 상자 여백·글자 간격·행간·단락 간격도 같은 변환 스케일로 별도 처리한다. 이 규칙을 코드의 UnitConverter 단일 모듈로 고정하고 픽스처를 작성한다.
7. PDF·PPTX·HTML 출력의 충실도 정책
출력 유형
출력	사용자 선택	수정 가능성	보존 목표
HTML	편집 가능한 단일 HTML	앱에서 재편집 가능	네이티브 모델 원본 수준. 외부 리소스 사용 시 경고
HTML	가벼운 발표 전용 HTML	제한적	모델·편집 런타임 제거로 경량화 가능; 재편집 불가 경고
PDF	브라우저 인쇄 → PDF 저장	일반적인 PDF 편집 기능 수준	선택·검색 가능한 텍스트를 가능한 한 보존. 브라우저·인쇄 설정 영향
PDF	정확도 우선 서버/로컬 CLI (후속)	일반적인 PDF	Playwright Chromium으로 재현 가능하게 변환; 서버에 파일을 보낼 경우 명시적 동의
PPTX	편집 우선	매핑 가능한 텍스트/도형/차트	편집성을 우선, 텍스트 줄바꿈·효과 일부 차이 가능
PPTX	외관 우선	슬라이드 대부분 이미지	디자인을 우선, 배경 이미지 내 원래 요소는 수정 불가
PPTX	하이브리드 (후속 검토)	핵심 텍스트만 별도 객체	이미지 배경 + 선택 텍스트를 조합; 겹침·중복 주의


PDF 세부 명세
- 브라우저의 **인쇄 대화상자에서 ‘PDF로 저장’**하는 방식은 웹앱이 PDF 바이너리를 직접 제공하는 것과 다르다. UI에 구분한다.
- print CSS는 16:9 용지 크기를 선언하고 여백 0, 슬라이드마다 페이지 나눔을 적용한다. print-color-adjust: exact, 브라우저별 백그라운드 인쇄 설정을 검증한다.
- 전환 효과, 스크롤바, 편집 컨트롤, hover 상태를 인쇄에서 제거한다. 차트/폰트/이미지 준비 상태를 기다린 뒤 인쇄한다.
- 직접 다운로드가 필요할 경우, (a) 이미지 기반 클라이언트 PDF의 한계 또는 (b) 선택 서버·로컬 CLI의 프라이버시/설치 비용을 설명한다. 설치 없는 직접 다운로드 + 텍스트 보존 + 임의 CSS 완전 충실이라는 세 요구를 무조건 동시에 보장하지 않는다.
- 선택 서버의 Playwright page.pdf()는 printBackground, preferCSSPageSize, width/height, 폰트 준비 검증을 지정해 사용한다.
PPTX 변환 세부 명세
PptxGenJS 4.0.1이 2026-11-02 조사에서 확인되는 최신 공식 릴리스로 표시된다. 의존성 고정 전 실제 버전/호환성 재확인한다.
- text: TipTap 런을 PPTX 텍스트 런으로 변환. 굵기·기울임·색·크기·링크 외에 charSpacing, outline, shadow, lineSpacing 등 현재 API가 제공하는 항목도 실제 변환 시험을 수행한다. API 지원 ≠ CSS 완전 동일.
- image: PNG/JPEG 등 PPTX가 확실히 지원하는 포맷으로 정규화하고 원본 이미지 품질·투명도를 관리한다. WebP를 PPTX에 무조건 그대로 넣지 않는다.
- SVG: 최신 PowerPoint에서 SVG 지원이 있는 만큼 SVG 네이티브 삽입을 먼저 검증하고, 호환성이 부족한 프로그램용 PNG 폴백을 둔다. SVG를 무조건 PNG로 바꾸지 않는다.
- shape, line, table: 네이티브 객체를 만들고 선/채우기/모서리/정렬을 매핑한다. 복잡한 CSS 효과는 폴백·손실 보고.
- chart: 공통 데이터 모델이 남아 있는 차트만 네이티브 차트로 매핑. 원본 ECharts의 DOM·SVG·Canvas만 있는 경우에는 데이터 편집 가능한 차트가 아님을 명시한다.
- html, code, 외부 embed: 시각 이미지 또는 안전한 텍스트/도형 부분 변환. 동적 효과·프레임은 PPTX에서 정적 대체.
- video: PptxGenJS가 API를 제공하더라도 실제 PowerPoint/Keynote/Google Slides에서 미디어 코덱과 동작 호환성을 검증한 뒤 공개한다.
- notes: 공식 addNotes API를 이용해 변환하고 PowerPoint에서 확인한다.
- transition, animation: 정적 PPTX 출력에서 기본적으로 보존하지 않는다. 네이티브 변환을 추가하려면 별도 검증 범위.
PPTX 보고서 예시
문서: 26장 / 312개 요소
모드: 편집 우선
네이티브 편집 요소: 251개
SVG 삽입: 18개
이미지 폴백: 35개
손실/치환 경고: 8개
  - 4장: CSS backdrop-filter → 이미지 변환
  - 9장: 외부 Pretendard 폰트 설치 확인 필요
  - 13장: 자바스크립트 차트 → 정적 이미지
  - 17장: 외부 iframe 미포함
위 숫자는 형식 설명을 위한 가상 예시이지 실제 변환 성적이 아니다. 각 경고는 슬라이드 위치와 객체 ID를 포함한다.
PPTX 검증의 엄격한 구분
- python-pptx로 읽혀 객체가 있다고 해서 PowerPoint 렌더링까지 완벽하다는 뜻은 아니다.
- LibreOffice에서 PDF 변환 성공이 Microsoft PowerPoint/Keynote/Google Slides 호환을 증명하지는 않는다.
- 구조 검사: ZIP/OOXML 무결성, 슬라이드 수, 텍스트 추출, 노트, 차트 데이터 존재, 이미지 미디어.
- 시각 검사: HTML 원본과 PPTX 렌더 캡처의 유사도, 텍스트 누락, 경계 넘침, 한글 폰트 대체.
- 수동 호환 검사: PowerPoint Windows, Keynote macOS, Google Slides import에서 지정된 골든 덱 검증.
- 출력 결과가 깨지면 외관 우선 PPTX로 다시 내보내기 안내.
8. 폰트·이미지·차트·오프라인 정책
폰트
기본 사용자 경험을 위해 한글 UI는 Pretendard를 채택할 수 있다. 발표 자료에 사용된 폰트는 폰트 관리 센터에서 설치 상태·외부 다운로드·라이선스·PPTX 치환 결과를 표시한다.
- 시스템 폰트, 앱 제공 OFL 폰트, 사용자가 직접 제공한 폰트 등 출처를 구분한다.
- 오프라인 출력 옵션의 실제 오프라인 사용 가능을 검증하기 전에는 완전한 self-contained라고 표시하지 않는다.
- 폰트 서브셋은 사용된 글리프만 저장해 크기를 줄일 수 있으나, 나중에 편집해 새로운 한글 문자를 입력하면 글리프 부족이 발생할 수 있다. 발표 전용 subset과 재편집용 충분한 글리프 정책을 분리한다.
- 글자 박스 넘침·한글 조합·줄바꿈·영문 혼합·특수기호·이모지 대체 문제를 테스트한다.
- Pretendard 공식 라이선스: https://github.com/orioncactus/pretendard/blob/main/packages/pretendard/dist/LICENSE.txt
이미지
- 이미지 삽입 시 MIME 감지·디코드 확인·최대 용량/해상도/자원 사용량 제한.
- 자동 WebP 축소는 옵션이며, 로고·스크린샷·텍스트가 포함된 이미지의 열화가 생길 수 있다. 고품질 무손실 PNG를 보존할 수 있게 한다.
- 원본/편집용/썸네일용 파생 이미지를 구분하고, 동일 파일은 해시로 중복 제거한다.
- SVG는 스크립트·외부 참조·이벤트 핸들러 등을 제거한 안전한 서브셋만 내장한다.
- Crop 상태, 원본 종횡비, 객체 위치를 문서 모델에 저장한다.
차트
차트 데이터 모델에는 시리즈·범례·축·단위·툴팁·색상·형식을 명시한다. PPTX 기본 지원 유형은 검증한 bar/line/pie/area/scatter 중심으로 제한하며, 고급 그래프는 SVG/PNG 폴백을 권장한다. 문서에 데이터가 없고 화면만 있는 그래프를 데이터 편집형 차트로 오인하지 않게 한다.
오프라인
오프라인 배포 시 폰트/스크립트/CSS/이미지/외부 동영상/iframe/CDN이 남지 않았는지 검사한다. 외부 링크 콘텐츠는 클릭하여 온라인 접속하는 것과 발표를 위한 필수 리소스에 의존하는 것을 구분한다. PWA 서비스워커 캐시는 독립 file:// HTML의 오프라인성 증거가 아니다.
9. 보안 및 개인 정보 보호 위협 모델
이 프로그램은 일반 문서가 아니라 HTML과 SVG를 가져오는 편집기이므로 악성 파일 위험이 상대적으로 높다. 단일 HTML이 그대로 열릴 때 스크립트 실행이 가능할 수도 있어 앱을 안전하게 배포하는 것과 임의로 받은 HTML 파일을 안전하게 실행하는 것은 별개의 문제다.
위협	방어 정책	검증
HTML/DOM XSS	DOMPurify 등 검증된 정화, 허용 목록 기반 파서, Trusted Types 적용 가능성 확인	이벤트 속성·script·svg payload 픽스처
JSON-in-HTML 탈출	<script type=application/json> 직렬화에서 </script> 등을 HTML 문맥에 맞게 안전 인코딩	악의적 제목/본문 입력 왕복 테스트
iframe 권한 상승	기본 sandbox에서 스크립트 미허용. allow-scripts+`allow-same-origin` 동시 허용 금지	권한/오리진/메시지 테스트
외부 서버로 정보 유출	기본 정적 가져오기에서 외부 URL·CSS URL·iframe 리소스 차단 또는 경고	개발자 네트워크 기록, CSP 검증
SVG/이미지 악성 콘텐츠	타입·용량 검사, 안전한 SVG 정화, 이미지 디코드 후 재인코딩 정책	안전한 샘플+악성 샘플 테스트
파일/저장소 남용	최대 슬라이드·자산·압축 해제 크기·시간 제한, 저장소 쿼터 처리	대용량 파일/ZIP 폭탄 테스트
퍼블릭 데모 콘텐츠	사용자 자료 서버 업로드 없음(기본). 저장·분석·텔레메트리 정책 공개	브라우저 네트워크 검사
외부 서버 PDF 서비스	명시적 옵트인, 임시 파일 자동 삭제, 서버 격리·리소스 제한, 보관 기간 공개	침투 테스트·운영 로그 검증
PWA 및 CDN 공급망	의존성 고정, SBOM, SCA 감사, 릴리스 재현성	Dependabot/CodeQL/CI


보안 판단 기준: CSP를 넣었다는 사실만으로 로컬 HTML의 안전성이 보장되지 않는다. CSP는 호스팅 정책과 파일 경로에 따라 적용 조건이 달라진다. HTML을 일반 웹 페이지로 공개할 경우 퍼블릭 호스팅에서 업로드된 사용자 HTML이 앱과 동일 출처로 실행되지 않도록 별도 출처/다운로드 처리 방침을 수립한다.

참고:
- OWASP DOM-based XSS: https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html
- OWASP File Upload: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- MDN iframe sandbox: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe
10. 기술 스택 재정의
계층	기본 선택	추가·수정 사항
앱	TypeScript, React, Vite	UI 전용. 렌더러는 React 비종속 목표 유지
상태/명령	Zustand, immer	커맨드 버스·트랜잭션·history 패치를 core에 분리
캔버스	DOM + CSS Transform	첫 주에 이동·리사이즈·줌·키보드·좌표 변환 프로토타입 비교. react-moveable은 예비 후보가 아니라 비교군으로 시험
텍스트	TipTap/ProseMirror	텍스트 런 손실 없는 HTML/PPTX 어댑터, 한글 IME 회귀 테스트
기존 HTML	DOMParser, DOMPurify, 격리된 렌더/검사 어댑터	신규 필수 패키지 import-legacy-html, 패치 저널, confidence score
schema	Zod + JSON Schema 발행	저장·가져오기·AI 생성용 단일 문서 계약
에셋	idb + sha256 인덱스 + 이미지 decode	원본 보존/파생 자산/용량 제한
PPTX	PptxGenJS	4.0.x API 시험 후 버전 고정, native/fidelity 전략 분리
PDF	브라우저 인쇄	직접 PDF 파일 생성은 선택적 서버/CLI 또는 래스터 모드로 표시
차트	ECharts	HTML 렌더 + 공통 차트 데이터 + PPTX 차트 어댑터 분리
코드	Shiki	정적 HTML 내보내기에만 구문 강조 결과 보존
아이콘	Lucide/안전한 SVG	가능한 경우 PPTX SVG 삽입을 시험, PNG 폴백
접근성	Radix UI 등	전체 접근성 목표 중 캔버스 키보드 동작은 별도 검증
테스트	Vitest, Playwright, axe-core	레거시 HTML 픽스처·그림 비교·출력 파일 검증 추가
개발환경	pnpm workspace, GitHub Actions	멀티패키지 모노레포, lockfile 고정, SBOM·release gate


추천 저장소 구조
html-ppt-studio/               # 작업명: 공개 전 변경
├── apps/
│   ├── editor-web/            # React 에디터 UI
│   ├── demo/                  # GitHub Pages 데모
│   └── export-service/        # 선택적 Playwright PDF 서비스 (후속)
├── packages/
│   ├── document-core/         # JSON schema, commands, migration
│   ├── slide-renderer/        # editor/viewer/thumbnail 공통 HTML·DOM 렌더
│   ├── interaction/           # selection/drag/resize/snap/zoom/keyboard
│   ├── import-legacy-html/    # HTML 탐지, 격리, patch journal, DOM 변환
│   ├── import-md-json/        # Markdown·JSON·AI 모델 가져오기
│   ├── asset-manager/         # 이미지/폰트/SVG/중복 제거
│   ├── export-html/           # self-contained HTML 직렬화
│   ├── export-pptx/           # 네이티브/외관 PPTX 변환
│   ├── export-pdf/            # 브라우저 print · 서버 어댑터
│   ├── export-report/         # 가져오기·내보내기 손실/경고 공통 형식
│   └── design-system/         # UI 스타일, i18n, 테마
├── fixtures/
│   ├── native-decks/          # JSON/HTML 왕복 픽스처
│   ├── legacy-html/           # 실제 AI 생성 HTML 유형별 픽스처
│   └── malicious-inputs/      # XSS 및 자원 고갈 공격 픽스처
├── e2e/
├── docs/
├── scripts/
└── .github/workflows/
패키지 경계 규칙: document-core는 DOM/React에 의존하지 않는다. slide-renderer는 React에 의존하지 않는다. export-pptx는 모델과 에셋 어댑터만 참조하며 앱 상태를 읽지 않는다. import-legacy-html은 원본 코드를 에디터 문맥에서 실행하지 않는다.
11. 성능·품질·접근성 기준
다음 수치는 **설계 목표(초기 가설)**이며 장비·브라우저·픽스처를 확정한 뒤 Phase 0에서 기준선을 측정한다.
영역	목표	검증 방식
사용성	실제 HTML 26장 자료에서 지정 텍스트 3개·이미지 1개를 수정하고 저장/재열기 성공	실제 파일 기반 수동 + E2E
문서 왕복	Native HTML → Import → Save → Import 시 정규화 후 모델 해시 동일	자동 픽스처 테스트
변경 보존	사용자가 수정한 텍스트·이미지 100% 유지, 미지원 요소는 경고 없이 누락하지 않음	content diff, 경고 리스트
캔버스	통상적인 10~30장 문서에서 드래그 중 끊김 없이 사용	프레임 타이밍 수집
대용량	100장/1,000요소 시 뷰포트 가상화, UI 스레드 장시간 블로킹 방지	성능 프로파일
편집 반응	단순 요소 이동의 입력 지연 목표 100ms 미만(시험 기준)	CPU 프로파일 / 상호작용 테스트
초기 로드	데모 및 골든 덱에 대해 공정한 장비/네트워크 프로필별 목표 수립	Lighthouse/Playwright
접근성	메뉴/파일/슬라이드 탐색/주요 편집 동작 키보드 접근, 포커스 및 명도 검사	axe-core + 수동
단위 테스트	core/export/import 중요 분기 위주 80% 이상 커버리지 목표	Vitest coverage
E2E	릴리스 차단용 핵심 시나리오 정의된 전 항목 통과	Chromium/Firefox/WebKit
시각 회귀	골든 덱과 비교, 폰트·OS 고정. 기계적 0.1% 단일 임계치 대신 영역별 허용값	Playwright screenshot diff
호환성	Chrome/Edge 주요 기능, Firefox/Safari 다운로드 폴백	실브라우저 테스트
보안	미해결 Critical/High 취약점 0건, 예외는 문서화·책임자 승인	SCA·CodeQL·수동 검증
데이터 안전	저장 실패 시 즉시 안내, 원본 보호, 복구 가능한 마지막 스냅샷 제공	오류 주입 테스트


테스트 골든 덱 구성
1. 텍스트 100개, 혼합 한국어/영어/숫자, 여러 굵기·폰트·줄바꿈.
2. 어두운 배경·그라데이션·도형·그림자·투명도.
3. 사진 crop·WebP/PNG/SVG·배경 이미지.
4. 표·차트·코드 블록.
5. 복잡한 CSS grid/flex 기반 기존 HTML, JS 기반 슬라이드, 외부 폰트 링크 등.
6. </script> 문자열, 악성 SVG, onclick, 데이터 URL, 외부 네트워크 참조.
7. 26장/50MB 근접 데이터와 100장/1,000개 요소 스트레스 데이터.
E2E 주요 플로우 (실행별 명시)
- E2E-01 새 덱 생성→텍스트/사진/도형 삽입→새로고침 후 지속.
- E2E-02 다중 선택→이동/크기 조절→undo/redo.
- E2E-03 네이티브 HTML 저장→파일 열기→재편집→재저장.
- E2E-04 기존 HTML 가져오기→정적 텍스트 수정→원본과 비교→재열기.
- E2E-05 발표자 화면/키보드/슬라이드 노트.
- E2E-06 HTML 오프라인 직접 열기 및 네트워크 차단 환경 발표.
- E2E-07 브라우저 인쇄·페이지 수·페이지 비율 확인.
- E2E-08 PPTX 편집 우선 구조 검증 및 외관 우선 캡처 비교.
- E2E-09 저장 실패/권한 취소/쿼터 초과.
- E2E-10 악성 HTML 차단 및 에디터 오리진 접근 방지.
12. 로드맵(가정 기반, 확정 일정 아님)
기존 전업 1인 12주에 기존 HTML 가져오기, 모든 요소, 발표자 보기, 완성도 높은 PPTX까지 구현한다는 일정을 확정 약속으로 삼지 않는다. 핵심 기술을 먼저 검증하고 이후 납기 범위를 정한다.
Phase	우선 개발 범위	통과 게이트	예상 기간*
0. 기술 실증	경쟁 프로젝트 실사, 샘플 HTML 3개 분석, 좌표·폰트·보안 PoC, 모델→HTML→모델 왕복	G0: 기존 파일 수정 가능성·출력 경로 증명	2~3주
1. 실사용 알파	기존 HTML의 L1 편집 + 이미지 교체 + 원본 보존, 네이티브 text/image/shape/line, 저장/발표/인쇄	G1: 본인 1건 실제 발표자료 수정·저장·재열기 성공	5~8주
2. 공개 베타	PPTX 외관 우선/편집 우선, 변환 보고, 레거시 L2 일부, 도형/표/차트, 접근성·오류 복구	G2: 골든 덱 구조·시각 품질 합격, 외부 3명 사용	7~10주
3. 안정화 v1.0	고품질 UI, 한/영 문서, 데모, PWA 오프라인, 테스트, 보안·라이선스·성능	G3: 핵심 E2E 전부 통과, 사용사례와 릴리스 문서 확보	4~7주


* 이 범위는 **일반적인 전업 1인 개발을 가정한 예비 계획(총 18~28주)**이며 객관적 납기 보장은 아니다. 기존 오픈소스를 안전하게 재사용하면 단축할 수 있지만 임의 HTML 변환·PPTX 충실도 문제로 늘어날 수 있다. 실제 가용 시간, 샘플 복잡도, 개발 방식(직접 코딩·AI 도구 병행)에 맞춰 G0 후 재산정한다.
Phase 0에 포함할 ‘3가지 기술 시험’
PoC A — HTML 편집성: 실제 HTML 1개에서 슬라이드를 추출하고 문구/이미지 교체 후 저장·재열기. 실패 이유, DOM 패치 비용, 보존되는 CSS를 측정한다.

PoC B — PPTX 충실도: 한글·영문 혼합 3장 예제로 텍스트 런/줄바꿈/자간/도형/PNG/SVG와 네이티브 차트를 변환하고 PowerPoint에서 확인한다.

PoC C — 안전한 단일 HTML: 외부 네트워크 차단 상태에서 파일 하나만 열어 발표; 앱에 악성 HTML을 임포트해도 script/외부 리소스가 실행·전송되지 않아야 한다.

게이트 정책: PoC 중 어느 하나가 실패하면 출시에 포함할 기능과 표현을 줄인다. 사용자에게 불가능한 편집성·충실도를 홍보하지 않는다.
13. 개발 순서: 우선 구현해야 할 백로그
우선순위	티켓	완료의 정의
P0	LEG-001 HTML 파일 탐지	일반 HTML과 전용 HTML을 구분, 슬라이드 수 판단 실패 시 수동 모드
P0	SEC-001 격리된 가져오기	악성 HTML 픽스처가 앱 문맥에서 실행되지 않음
P0	LEG-002 문구 바꾸기	원본 DOM·CSS를 보존하며 정적 텍스트 수정
P0	LEG-003 이미지 바꾸기	crop·레이아웃 붕괴 없이 교체, 재열기 유지
P0	DOC-001 JSON Schema v2	필드 단위 제약·마이그레이션·검증 에러
P0	EXP-001 단일 HTML	오프라인 file:// 발표와 재열기 테스트
P0	EDIT-001 텍스트·사진 기본 편집	네이티브 문서 요소 생성·이동·삭제
P1	EDIT-002 선택·리사이즈·정렬	키보드/마우스/줌 상호작용 테스트
P1	SAVE-001 히스토리·복구	자동저장·수동저장 실패 처리
P1	PRES-001 발표 모드	전체화면, 키보드, 노트
P1	EXP-002 PPTX 이중 모드	편집 우선과 외관 우선 출력, 리포트
P1	EXP-003 PDF 인쇄	장수·비율·배경·텍스트 검사
P2	LEG-004 HTML 레이어 변환	검증된 HTML 템플릿 범위의 L2 객체화
P2	UI-001 고품질 패널·테마	인터뷰 기반 사용성 검증
P2	QA-001 CI/시각 회귀	골든 덱/악성 입력 지속 테스트
P3	AI-001 JSON/Markdown 생성	스키마 기반 AI 생성 자료의 직접 편집
P3	PDF-001 서버/CLI PDF	직접 내려받기·선택적 비공개 처리


범위 통제: Phase 1에는 12개 요소 모두 구현하지 않는다. 적은 요소라도 실제 기존 HTML 파일을 가져와 고친 뒤 저장하는 문제를 해결하는 게 우선이다.
14. 공개 라이선스 및 개발 운영
프로젝트명
기존 DeckWright 제품 사용이 확인되므로 새 브랜드를 확정한다. HTML-PPT Studio는 내부 작업명일 뿐 이름 중복·상표·npm 패키지·GitHub 조직·도메인 가용성을 확인한 명칭이 아니다. 특정 후보의 사용 가능성을 단정하지 않는다.
라이선스
MIT를 1차 목표로 유지하되 직접 작성 코드와 포함되는 서드파티 리소스(특히 에디터, 아이콘, 폰트, 샘플 템플릿)의 라이선스를 따로 검토한다. AGPL/상용 라이선스가 적용되는 의존성의 무분별한 복사 금지. 다른 MIT 프로젝트에서 코드를 가져오는 경우에도 저작권 고지를 준수한다.
GitHub 기본 문서
LICENSE, README.ko.md, README.md, CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md, CHANGELOG.md, ARCHITECTURE.md, COMPATIBILITY.md, THREAT_MODEL.md, docs/schema-v2.md, docs/import-limitations.md, docs/export-fidelity.md, docs/decisions/ADR-*.md, issue/PR 템플릿, CHANGESETS.
CI/CD 게이트
1. Lint, Prettier, typecheck, unit/integration tests.
2. E2E(최소 Chromium 전 플로우, Firefox/WebKit 지원 플로우).
3. HTML/JSON 왕복 비교, 고정 골든 덱 시각 회귀.
4. PPTX ZIP/OOXML 구조 검증, python-pptx 객체 수, LibreOffice PDF 스모크 테스트.
5. 의존성 취약점·라이선스·SBOM, 버전 잠금 및 릴리스 노트 생성.
6. GitHub Pages 정적 데모 배포. 데모는 사용자 HTML을 서버에 업로드하지 않는 것이 기본 정책.
홍보 메시지
메시지는 “AI가 이미 만들어 준 HTML 발표자료, 글자 하나 때문에 다시 생성하지 마세요.”로 제안한다. 단일 페이지 데모에서 HTML 파일 드롭 → 텍스트 수정 → HTML 저장 → PPTX 옵션을 시연한다. SNS 홍보에서는 실제 사용자에게 도움이 된 시간을 보여주되 측정하지 않은 절감 시간을 단정하지 않는다.
15. 남아 있는 핵심 인터뷰 질문 — 구현 범위를 결정
프로덕션 계획을 최종 확정하기 전에 아래 실제 사용 방식을 확인하는 것이 가장 효과적이다. 답변이 없어도 G0는 잠정 가정으로 시작할 수 있다.
1. 기존 HTML의 구조: 실제로 수정하는 HTML은 슬라이드마다 <section> 등 별도 태그가 있는가? JS로 페이지 전환/애니메이션하는가? 가장 대표적인 파일 1개가 최우선.
2. 원하는 편집 깊이: 기존 HTML에서 텍스트·이미지 바꾸기만으로 대부분 해결되는가, 아니면 그 안의 개별 도형·차트·표 위치까지 반드시 옮겨야 하는가?
3. PPTX 우선순위: PowerPoint에서 텍스트/도형을 다시 수정할 수 있는 것이 더 중요한가, 아니면 폰트·디자인이 최대한 안 깨지는 것이 더 중요한가? (둘 다 선택은 가능하나 기본값을 정해야 함.)
4. 오프라인과 보안: 인터넷이 차단된 PC에서 최종 HTML과 편집기를 모두 사용해야 하는가, 아니면 HTML 발표 파일만 오프라인이면 충분한가?
5. 사용 환경: Windows + Chrome/Edge가 주력인가? 조직 내부 PC에서 프로그램 설치/서버 사용이 제한되는가?
6. 개발 투입: 주당 개발 가능 시간·AI 코딩 도구 활용 여부·선호 언어(한/영 기본값).
7. 제품의 차별성: 공개 후 일반 사용자용 프레젠테이션 툴인지, AI가 생성한 HTML을 보정하는 전문 툴인지 우선 하나를 선택할 것인가?
최우선 확인은 1번 HTML 샘플이다. 이 한 파일만 있어도 L1 호환 모드의 구현 난이도, 슬라이드 탐지, 복잡한 CSS 보존, 사진 교체, PPTX 폴백 방식을 훨씬 구체적으로 정할 수 있다.
16. 구현 금지 원칙 및 결정 기록(ADR)
- [ ] 임의 HTML을 100% 편집 가능한 PPTX로 바꿀 수 있다고 광고하지 않는다.
- [ ] HTML 파일의 JS를 앱 메인 페이지에서 직접 실행하지 않는다.
- [ ] JSON.stringify만으로 <script> 안에 JSON을 끼워 넣지 않는다.
- [ ] 사용자가 지정하지 않은 기존 파일을 자동으로 덮어쓰지 않는다.
- [ ] 이미지·폰트가 외부 URL에 있을 때 완전 오프라인이라고 표시하지 않는다.
- [ ] 코드의 px·pt 변환을 여러 곳에 중복 구현하지 않는다.
- [ ] CI에서 통과한 PPTX를 모든 Office 제품에서 완전 호환이라고 단정하지 않는다.
- [ ] 1인 개발 일정에 필수 검증 없는 기능 추가를 허용하지 않는다.
- [ ] 취약점 스캔 결과가 0건이라는 문구만으로 런타임 안전을 보증하지 않는다.
- [ ] 파일이 안전하다고 판단하는 데 SHA-256 해시 값만 사용하지 않는다.
제안 ADR 목록
- ADR-001: Native / Legacy dual mode and trust boundaries
- ADR-002: Document JSON schema v2 and HTML envelope
- ADR-003: Canvas unit and font conversion
- ADR-004: PPTX editable/fidelity export contract
- ADR-005: Asset deduplication and offline packaging
- ADR-006: Browser save fallback and backup policy
- ADR-007: Source HTML patch journal and conflicts
- ADR-008: Untrusted SVG, HTML and iframe policy
- ADR-009: Browser PDF vs Playwright PDF delivery
17. 검증 근거: 공식 문서·공개 소스
1. PptxGenJS 저장소 및 릴리스: https://github.com/gitbrent/PptxGenJS/releases
2. PptxGenJS 텍스트 API (charSpacing, outline, shadow, fontSize의 pt 단위): https://gitbrent.github.io/PptxGenJS/docs/api-text/
3. PptxGenJS speaker notes: https://gitbrent.github.io/PptxGenJS/docs/speaker-notes.html
4. PptxGenJS 이미지/SVG 지원: https://gitbrent.github.io/PptxGenJS/docs/api-images/
5. CSS W3C 절대 단위: https://www.w3.org/TR/css-values/
6. MDN showSaveFilePicker 및 보안 컨텍스트: https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker
7. Can I use 브라우저 지원: https://caniuse.com/mdn-api_window_showsavefilepicker
8. Playwright PDF API (printBackground, preferCSSPageSize): https://playwright.dev/docs/api/class-page
9. OWASP DOM-based XSS/JSON-in-HTML: https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html
10. OWASP 업로드·위험 파일 처리: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
11. MDN iframe sandbox: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe
12. Pretendard OFL-1.1: https://github.com/orioncactus/pretendard/blob/main/packages/pretendard/dist/LICENSE.txt
13. DeckWright 명칭 사용 사례: https://sangmin.me/software.html
14. NextPPT(MIT, 개발 중단 설명 포함): https://github.com/Trade-Offf/NextPPT
15. frontend-slides-editable(MIT): https://github.com/archlizheng/frontend-slides-editable
확인한 사실과 검증 예정 사항의 구분: 위 링크는 라이브러리 API와 공개 프로젝트 존재, 브라우저 기능 등 사실 근거를 제공한다. 기간 추정·성능 목표·L1/L2 지원 범위·지원 가능성을 나타내는 수치는 제품 설계 제안이며 구현 결과가 아니다. 실제 제품 지원 여부는 Phase 0 테스트 결과로 확정한다.
최종 권고
첫 출시의 경쟁력은 요소 타입이 12개냐 20개냐가 아니다. 지금 사용 중인 HTML 발표자료를 열고, 요청받은 글자 몇 개와 사진을 고친 뒤, 디자인을 거의 그대로 유지하고 다시 사용할 수 있느냐가 핵심이다. 이것부터 증명한 후 네이티브 편집기와 PDF/PPTX 품질을 확장해야 실제 사용자에게 유용한 오픈소스 제품이 된다.

---

# 구현 현황 (2026-11-03 기준)

이 절은 구현 후 추가했습니다. 위 계획의 본문은 고치지 않았습니다. 근거는 [G0 보고서](docs/phase0/G0-report.md)와 [호환성](COMPATIBILITY.md)에 있습니다.

## 계획에 없다가 추가한 것

- **SEC-002 파일 보안 검사.** 사용자 요청으로 추가했습니다. 정적 검사이며 백신이 아닙니다. "안전" 판정이 없습니다. [ADR-010](docs/decisions/ADR-010-security-scan.md)

## 계획과 다르게 한 것

- **PWA 오프라인 제외.** 발표 파일만 오프라인으로 동작하면 된다는 결정에 따랐습니다.
- **기본 글꼴은 Malgun Gothic.** Pretendard를 내장하지 않았습니다.
- **`apps/demo`, 내보내기 서버 없음.** 편집기를 그대로 정적 배포하고, PDF 파일은 로컬 명령 `pnpm deck-to-pdf`로 만듭니다.
- **36행의 Slidewright.** 조사 결과 HTML 시각 편집기로 확인되지 않았습니다. [oss-audit.md](docs/phase0/oss-audit.md)

## 게이트 상태

- **G0:** 합성 샘플 기준 통과. 실제 파일 확인이 남아 조건부입니다.
- **G2, G3:** 외부 사용자 3명 시험을 하지 않아 미충족입니다.

## 아직 정하지 않은 것

- 제품 이름과 상표 확인. "HTML-PPT Studio"는 작업명입니다.
