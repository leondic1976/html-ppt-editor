export type Locale = 'ko' | 'en';

/** UI chrome strings. Scan findings and import warnings are Korean-only for now (see COMPATIBILITY.md). */
const STRINGS = {
  'app.name': { ko: 'HTML-PPT Studio', en: 'HTML-PPT Studio' },
  'home.tagline': {
    ko: 'AI가 이미 만들어 준 HTML 발표자료, 글자 하나 때문에 다시 생성하지 마세요.',
    en: "Don't regenerate an AI-made HTML deck just to fix one word.",
  },
  'home.drop': {
    ko: 'HTML 파일을 여기에 끌어다 놓거나 클릭해서 여세요',
    en: 'Drop an HTML file here, or click to open',
  },
  'home.dropHint': {
    ko: '파일은 이 브라우저 안에서만 처리되며 어디로도 전송되지 않습니다. 파일 안의 스크립트는 실행되지 않습니다.',
    en: 'Files stay in this browser and are never uploaded. Scripts in a file never run.',
  },
  'home.new': { ko: '새 문서', en: 'New deck' },
  'home.templates': { ko: '템플릿으로 시작', en: 'Start from a template' },
  'home.scanOnly': { ko: '파일 보안 검사만 하기', en: 'Only scan a file' },
  'home.recover': { ko: '복구할 수 있는 작업', en: 'Recoverable work' },
  'menu.file': { ko: '파일', en: 'File' },
  'menu.edit': { ko: '편집', en: 'Edit' },
  'menu.insert': { ko: '삽입', en: 'Insert' },
  'menu.view': { ko: '보기', en: 'View' },
  'menu.present': { ko: '발표', en: 'Present' },
  'menu.export': { ko: '내보내기', en: 'Export' },
  'file.open': { ko: '열기…', en: 'Open…' },
  'file.save': { ko: '저장', en: 'Save' },
  'file.saveAs': { ko: '다른 이름으로 저장…', en: 'Save as…' },
  'file.saveZip': { ko: 'HTML + assets ZIP으로 저장…', en: 'Save as HTML + assets ZIP…' },
  'file.close': { ko: '닫기', en: 'Close' },
  'file.history': { ko: '버전 기록…', en: 'Version history…' },
  'file.security': { ko: '보안 검사 결과…', en: 'Security scan results…' },
  'file.import': { ko: '가져오기 보고서…', en: 'Import report…' },
  'file.fonts': { ko: '글꼴 관리…', en: 'Fonts…' },
  'edit.undo': { ko: '실행 취소', en: 'Undo' },
  'edit.redo': { ko: '다시 실행', en: 'Redo' },
  'edit.copy': { ko: '복사', en: 'Copy' },
  'edit.paste': { ko: '붙여넣기', en: 'Paste' },
  'edit.duplicate': { ko: '복제', en: 'Duplicate' },
  'edit.delete': { ko: '삭제', en: 'Delete' },
  'edit.group': { ko: '그룹', en: 'Group' },
  'edit.ungroup': { ko: '그룹 해제', en: 'Ungroup' },
  'insert.text': { ko: '텍스트', en: 'Text' },
  'insert.image': { ko: '사진…', en: 'Image…' },
  'insert.shape': { ko: '도형', en: 'Shape' },
  'insert.line': { ko: '선', en: 'Line' },
  'insert.table': { ko: '표', en: 'Table' },
  'insert.chart': { ko: '차트', en: 'Chart' },
  'insert.code': { ko: '코드', en: 'Code' },
  'insert.slide': { ko: '새 슬라이드', en: 'New slide' },
  'view.fit': { ko: '화면에 맞춤', en: 'Fit to window' },
  'view.safe': { ko: '안전 영역 표시', en: 'Show safe area' },
  'view.grid': { ko: '눈금 표시', en: 'Show grid' },
  'view.compare': { ko: '원본과 비교', en: 'Compare with original' },
  'view.theme': { ko: '어두운 테마 전환', en: 'Toggle dark theme' },
  'view.language': { ko: 'English', en: '한국어' },
  'present.start': { ko: '처음부터 발표', en: 'Present from start' },
  'present.current': { ko: '현재 슬라이드부터', en: 'Present from current' },
  'present.presenter': { ko: '발표자 보기 열기', en: 'Open presenter view' },
  'export.html': { ko: '편집 가능한 HTML', en: 'Editable HTML' },
  'export.htmlPresent': { ko: '가벼운 발표 전용 HTML', en: 'Light presentation-only HTML' },
  'export.print': {
    ko: '인쇄 / PDF로 저장 (브라우저 인쇄 창)',
    en: 'Print / Save as PDF (browser dialog)',
  },
  'export.pptxEdit': { ko: 'PPTX — 편집 우선', en: 'PPTX — editable first' },
  'export.pptxLook': { ko: 'PPTX — 외관 우선', en: 'PPTX — appearance first' },
  'export.json': { ko: 'JSON 문서', en: 'JSON document' },
  'legacy.convertL2': { ko: '요소 편집으로 변환 (L2)', en: 'Convert to elements (L2)' },
  'legacy.convertL3': { ko: '화면 고정으로 변환 (L3)', en: 'Freeze as pictures (L3)' },
  'legacy.slides': { ko: '슬라이드 구분 지정…', en: 'Set slide division…' },
  'legacy.allowExternal': {
    ko: '외부 이미지·글꼴 불러오기 허용',
    en: 'Allow external images and fonts',
  },
  'status.saved': { ko: '저장됨', en: 'Saved' },
  'status.unsaved': { ko: '저장 안 됨', en: 'Unsaved' },
  'status.autosaved': { ko: '브라우저에 자동 저장됨', en: 'Autosaved in browser' },
  'common.close': { ko: '닫기', en: 'Close' },
  'common.cancel': { ko: '취소', en: 'Cancel' },
} as const satisfies Record<string, Record<Locale, string>>;

export type StringKey = keyof typeof STRINGS;

let locale: Locale = 'ko';
export const setLocale = (l: Locale): void => {
  locale = l;
};
export const getLocale = (): Locale => locale;
export const t = (key: StringKey): string => STRINGS[key][locale];

/** Fonts offered in pickers. Listed by licence so the font centre can state them. */
export const FONT_CHOICES: { name: string; note: string; source: 'system' | 'install' }[] = [
  { name: 'Malgun Gothic', note: 'Windows 기본', source: 'system' },
  { name: 'Pretendard', note: 'OFL, 설치 필요', source: 'install' },
  { name: 'Noto Sans KR', note: 'OFL, 설치 필요', source: 'install' },
  { name: 'Nanum Gothic', note: 'OFL, 설치 필요', source: 'install' },
  { name: 'Arial', note: '시스템', source: 'system' },
  { name: 'Georgia', note: '시스템', source: 'system' },
  { name: 'Times New Roman', note: '시스템', source: 'system' },
  { name: 'Consolas', note: 'Windows 고정폭', source: 'system' },
];
