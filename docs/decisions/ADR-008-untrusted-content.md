# ADR-008: 신뢰할 수 없는 SVG, HTML, iframe 정책

**결정.** 파일의 코드를 실행하지 않습니다. 미리보기는 독립적인 네 겹으로 막습니다.

1. **AST 살균:** `script`, `iframe`, `object`, 이벤트 처리기, `javascript:`, 외부 URL 제거. 복사본에만 적용합니다.
2. **DOMPurify:** 다른 구현으로 다시 검사합니다.
3. **`sandbox="allow-same-origin"`:** `allow-scripts`가 없으므로 안에서 코드가 실행되지 않습니다. 부모가 DOM을 다룰 수 있어 클릭 편집이 가능합니다.
4. **CSP:** `default-src 'none'`을 모든 작성자 노드보다 앞에 둡니다.

**왜 `allow-same-origin`인가.** `allow-scripts`와 함께 쓰면 샌드박스가 무력화되지만, 단독으로는 부모가 DOM에 접근하게 할 뿐입니다. 대안인 `postMessage` 구조는 프레임 안에서 스크립트가 돌아야 하므로 더 위험합니다. 실사한 NextPPT는 `allow-scripts allow-same-origin`을 함께 쓰며, 가져온 코드가 편집기 출처에서 실행됩니다. 이것이 피하려는 구조입니다.

**실행 모드 없음.** 원본 JS 실행 모드(plan의 v1.x 고급 기능)는 구현하지 않았습니다. 하려면 별도 출처와 네트워크 격리가 먼저 필요합니다.

**검증에서 찾은 버그.**

- parse5가 SVG 속성을 `attributeName`으로 복원해 소문자 비교를 통과하던 `<animate>` 경로를 고쳤습니다.
- CSS `url()` 비컨이 CSP에만 의존하던 것을 살균 단계에서도 제거했습니다.

**SVG.** 이미지로 넣을 때는 스크립트·`foreignObject`·외부 참조를 제거하고 `<img>`로만 표시합니다.
