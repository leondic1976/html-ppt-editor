# 문서 형식 v2

공개 계약은 [schema-v2.json](schema-v2.json)이며 `pnpm schema`로 만듭니다(Zod 원본: `packages/document-core/src/schema.ts`). LLM이나 도구는 이 스키마로 JSON을 만들어 앱에서 열 수 있습니다. 검증 오류는 필드 경로와 함께 표시됩니다.

## 구조

```jsonc
{
  "formatVersion": 2,
  "docId": "doc-example",
  "appVersion": "0.1.0",
  "rendererVersion": "1",
  "lastSavedAt": "2026-11-02T00:00:00.000Z",
  "migrationHistory": [],
  "meta": { "title": "샘플 발표", "locale": "ko-KR" },
  "page": { "width": 1920, "height": 1080, "unit": "model-px", "ratio": "16:9" },
  "theme": {
    "fontFamily": "Malgun Gothic",
    "fontFallback": ["Apple SD Gothic Neo", "Noto Sans KR", "Arial", "sans-serif"],
    "tokens": { "background": "#ffffff", "foreground": "#0f172a", "accent": "#2563eb" },
  },
  "assets": {
    "sha256-…": { "kind": "image", "mime": "image/png", "size": 1024, "source": "embedded" },
  },
  "slides": [
    {
      "id": "slide-1",
      "background": { "type": "solid", "color": "#0f172a" },
      "notes": "발표자 노트",
      "elements": [
        {
          "id": "el-1",
          "type": "text",
          "frame": { "x": 160, "y": 350, "w": 1600, "h": 170, "rotate": 0 },
          "zIndex": 1,
          "content": {
            "type": "doc",
            "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "제목" }] }],
          },
          "style": { "fontSizePx": 100, "fontWeight": 700, "align": "center" },
        },
      ],
    },
  ],
  "legacy": null,
}
```

요소 종류는 `text`, `image`, `svg`, `shape`, `line`, `table`, `chart`, `code`입니다.

## 설계 규칙

- **원시 HTML 필드가 없습니다.** `code`의 강조도 HTML이 아니라 토큰 배열입니다. 위조된 파일이 HTML을 끼워 넣을 자리가 없습니다.
- **색은 hex 또는 `transparent`만** 받습니다. 글꼴 이름에서 CSS 특수문자를 막습니다. 두 값 모두 style 속성에 들어가기 때문입니다.
- **자산 ID는 내용의 SHA-256**입니다. 같은 파일은 하나만 저장합니다. 해시는 내용 확인용이고 안전성을 뜻하지 않습니다.
- **단위:** 모델 좌표는 논리 픽셀입니다. 변환 규칙은 [ADR-003](decisions/ADR-003-units.md).

## 단일 HTML 안에서의 위치

```html
<meta name="hps-format" content="2;editable" />
<main id="hps-stage">… 미리 렌더링된 슬라이드 …</main>
<script type="application/json" id="hps-document">
  … 모델 …
</script>
<script type="application/json" id="hps-assets">
  { "sha256-…": "data:image/png;base64,…" }
</script>
<script>
  … CSP 해시로 고정된 런타임 …
</script>
```

재편집은 JSON 기준이고, 슬라이드 DOM은 표시용입니다. 이미지는 저장소에 한 번만 두고 런타임이 연결하므로 base64가 중복되지 않습니다.

## 마이그레이션

`formatVersion`이 낮으면 단계별로 올리고 `migrationHistory`에 남깁니다. 더 높으면 앱 업데이트를 안내합니다. 저장 전에 다시 검증하므로, 앱이 스스로 읽지 못할 파일을 쓰지 않습니다.
