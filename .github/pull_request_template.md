## 무엇을, 왜

## 확인한 것

- [ ] `pnpm typecheck && pnpm test`
- [ ] 화면이 바뀌면 `pnpm test:e2e`
- [ ] 가져오기·내보내기를 건드렸으면 픽스처 추가 (`fixtures/`)
- [ ] PPTX를 건드렸으면 PowerPoint에서 직접 확인 (`scripts/verify-powerpoint.ps1`), 못 했으면 그렇게 적기
- [ ] 스캔 규칙을 건드렸으면 정상 파일 오탐 테스트 추가

## 지키는 원칙 ([plan.md §16](../plan.md))

- [ ] 가져온 파일의 코드를 앱에서 실행하지 않음 (`allow-scripts` 금지)
- [ ] 변환 불가능한 내용을 조용히 버리지 않고 보고함
- [ ] 측정하지 않은 호환성·안전성을 단정하지 않음
