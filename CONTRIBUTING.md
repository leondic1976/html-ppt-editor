# 기여 안내

```sh
pnpm install
pnpm dev
pnpm typecheck && pnpm lint && pnpm test
pnpm build && pnpm test:e2e    # Chrome과 Edge가 설치되어 있어야 합니다
```

## 원칙

[plan.md §16](plan.md)의 금지 원칙을 지켜 주세요. 특히 다음은 리뷰에서 막습니다.

- 가져온 파일의 코드를 앱에서 실행하는 변경. `allow-scripts`를 주는 코드는 `scripts/check-boundaries.mjs`가 막습니다.
- 변환하지 못한 내용을 보고 없이 버리는 변경.
- 측정하지 않은 호환성·안전성을 UI나 문서에 단정하는 표현.

## 패키지 경계

`pnpm boundaries`로 확인합니다. `document-core`와 `security-scan`은 다른 패키지와 DOM에 의존하지 않고, `slide-renderer`는 React에 의존하지 않으며, `export-pptx`는 앱 상태를 읽지 않습니다. 자세한 내용은 [ARCHITECTURE.md](ARCHITECTURE.md)를 보세요.

## 테스트

- **가져오기·저장:** `fixtures/legacy-html/`에 유형별 샘플을 추가하고 왕복 테스트를 작성합니다. 픽스처는 바이트가 중요하므로 `scripts/build-fixtures.mjs`로 만듭니다.
- **스캔 규칙:** 잡아야 할 사례와 함께 **잡으면 안 되는 정상 사례**를 테스트하세요. 악성 픽스처는 동작하지 않는 무해한 내용(`.invalid` 도메인)만 씁니다. EICAR 문자열 전체는 소스나 파일에 그대로 넣지 마세요. 백신이 저장소를 격리합니다.
- **PPTX:** 구조 테스트는 PowerPoint 렌더링을 증명하지 못합니다. PowerPoint가 있으면 `scripts/verify-powerpoint.ps1`로 확인하세요.
- **시각 회귀:** 기준 이미지는 Windows + Chrome입니다. 의도한 변경이면 `pnpm test:e2e --update-snapshots`.

## 동기화 폴더에서 작업할 때

구글 드라이브 등에 저장소를 두면 동기화 프로그램이 파일을 잠가 `EBUSY` 오류가 날 수 있습니다. 그래서 E2E 산출물은 OS 임시 폴더에 씁니다.

## 변경 기록

사용자에게 보이는 변경은 `pnpm changeset`으로 기록합니다.
