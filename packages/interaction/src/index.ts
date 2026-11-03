/**
 * Pure geometry for selection, drag, resize, snap and alignment. No DOM: all inputs and outputs
 * are model coordinates, so zoom can never leak into document data (plan §6.3).
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Frame extends Rect {
  rotate: number;
}
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export const screenToModel = (px: number, zoom: number): number => px / zoom;

export function boundsOf(frames: Rect[]): Rect | null {
  if (!frames.length) return null;
  const x = Math.min(...frames.map((f) => f.x));
  const y = Math.min(...frames.map((f) => f.y));
  const r = Math.max(...frames.map((f) => f.x + f.w));
  const b = Math.max(...frames.map((f) => f.y + f.h));
  return { x, y, w: r - x, h: b - y };
}

/** Axis-aligned box of a rotated frame, used for snapping and marquee hit tests. */
export function rotatedBounds(f: Frame): Rect {
  if (!f.rotate) return { x: f.x, y: f.y, w: f.w, h: f.h };
  const rad = (f.rotate * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const w = f.w * c + f.h * s;
  const h = f.w * s + f.h * c;
  return { x: f.x + f.w / 2 - w / 2, y: f.y + f.h / 2 - h / 2, w, h };
}

export const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export interface ResizeOptions {
  keepRatio?: boolean;
  fromCenter?: boolean;
  minSize?: number;
}

/**
 * Resize by dragging a handle. The delta is taken in the element's rotated axes and the frame is
 * re-centred afterwards, so the corner opposite the handle stays fixed on screen.
 */
export function resizeFrame(
  start: Frame,
  handle: Handle,
  dx: number,
  dy: number,
  opts: ResizeOptions = {},
): Frame {
  const minSize = opts.minSize ?? 8;
  const rad = (start.rotate * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Pointer delta in local axes.
  let lx = dx * cos + dy * sin;
  let ly = -dx * sin + dy * cos;

  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');
  if (!west && !east) lx = 0;
  if (!north && !south) ly = 0;

  const factor = opts.fromCenter ? 2 : 1;
  let w = start.w + (east ? lx : west ? -lx : 0) * factor;
  let h = start.h + (south ? ly : north ? -ly : 0) * factor;

  if (opts.keepRatio && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h;
    const edgeOnly = !(west || east) || !(north || south);
    if (edgeOnly) {
      if (west || east) h = w / ratio;
      else w = h * ratio;
    } else if (Math.abs(w / start.w) >= Math.abs(h / start.h)) h = w / ratio;
    else w = h * ratio;
  }
  w = Math.max(minSize, w);
  h = Math.max(minSize, h);

  if (opts.fromCenter) {
    return { ...start, x: start.x + (start.w - w) / 2, y: start.y + (start.h - h) / 2, w, h };
  }
  // Local offset of the centre, keeping the opposite edge fixed.
  const cdx = east ? (w - start.w) / 2 : west ? -(w - start.w) / 2 : 0;
  const cdy = south ? (h - start.h) / 2 : north ? -(h - start.h) / 2 : 0;
  const cx = start.x + start.w / 2 + cdx * cos - cdy * sin;
  const cy = start.y + start.h / 2 + cdx * sin + cdy * cos;
  return { ...start, x: cx - w / 2, y: cy - h / 2, w, h };
}

export function rotationFromPointer(frame: Rect, px: number, py: number, stepDeg?: number): number {
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  let deg = (Math.atan2(py - cy, px - cx) * 180) / Math.PI + 90;
  if (stepDeg) deg = Math.round(deg / stepDeg) * stepDeg;
  return ((deg % 360) + 360) % 360;
}

export interface SnapGuide {
  axis: 'x' | 'y';
  at: number;
  kind: 'slide' | 'element' | 'safe';
}
export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

export interface SnapInput {
  moving: Rect;
  others: Rect[];
  page: { width: number; height: number };
  threshold: number;
  safeMargin?: number;
}

/** Find the nearest alignment on each axis among slide centre/edges and other elements' edges/centres. */
export function computeSnap({
  moving,
  others,
  page,
  threshold,
  safeMargin,
}: SnapInput): SnapResult {
  const xTargets: { at: number; kind: SnapGuide['kind'] }[] = [
    { at: 0, kind: 'slide' },
    { at: page.width / 2, kind: 'slide' },
    { at: page.width, kind: 'slide' },
  ];
  const yTargets: { at: number; kind: SnapGuide['kind'] }[] = [
    { at: 0, kind: 'slide' },
    { at: page.height / 2, kind: 'slide' },
    { at: page.height, kind: 'slide' },
  ];
  if (safeMargin) {
    xTargets.push({ at: safeMargin, kind: 'safe' }, { at: page.width - safeMargin, kind: 'safe' });
    yTargets.push({ at: safeMargin, kind: 'safe' }, { at: page.height - safeMargin, kind: 'safe' });
  }
  for (const o of others) {
    xTargets.push(
      { at: o.x, kind: 'element' },
      { at: o.x + o.w / 2, kind: 'element' },
      { at: o.x + o.w, kind: 'element' },
    );
    yTargets.push(
      { at: o.y, kind: 'element' },
      { at: o.y + o.h / 2, kind: 'element' },
      { at: o.y + o.h, kind: 'element' },
    );
  }
  const best = (
    edges: number[],
    targets: typeof xTargets,
  ): { delta: number; target: (typeof xTargets)[number] } | null => {
    let found: { delta: number; target: (typeof xTargets)[number] } | null = null;
    for (const edge of edges) {
      for (const target of targets) {
        const delta = target.at - edge;
        if (Math.abs(delta) <= threshold && (!found || Math.abs(delta) < Math.abs(found.delta))) {
          found = { delta, target };
        }
      }
    }
    return found;
  };
  const bx = best([moving.x, moving.x + moving.w / 2, moving.x + moving.w], xTargets);
  const by = best([moving.y, moving.y + moving.h / 2, moving.y + moving.h], yTargets);
  const guides: SnapGuide[] = [];
  if (bx) guides.push({ axis: 'x', at: bx.target.at, kind: bx.target.kind });
  if (by) guides.push({ axis: 'y', at: by.target.at, kind: by.target.kind });
  return { dx: bx?.delta ?? 0, dy: by?.delta ?? 0, guides };
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** Align to the selection's bounds, or to the slide when a single element is selected. */
export function alignFrames(
  frames: Record<string, Rect>,
  mode: AlignMode,
  page: { width: number; height: number },
): Record<string, { x?: number; y?: number }> {
  const list = Object.values(frames);
  const box = list.length === 1 ? { x: 0, y: 0, w: page.width, h: page.height } : boundsOf(list);
  const out: Record<string, { x?: number; y?: number }> = {};
  if (!box) return out;
  for (const [id, f] of Object.entries(frames)) {
    switch (mode) {
      case 'left':
        out[id] = { x: box.x };
        break;
      case 'hcenter':
        out[id] = { x: box.x + (box.w - f.w) / 2 };
        break;
      case 'right':
        out[id] = { x: box.x + box.w - f.w };
        break;
      case 'top':
        out[id] = { y: box.y };
        break;
      case 'vcenter':
        out[id] = { y: box.y + (box.h - f.h) / 2 };
        break;
      case 'bottom':
        out[id] = { y: box.y + box.h - f.h };
        break;
    }
  }
  return out;
}

/** Even gaps between the outermost elements, which stay in place. Needs three or more. */
export function distributeFrames(
  frames: Record<string, Rect>,
  axis: 'x' | 'y',
): Record<string, { x?: number; y?: number }> {
  const entries = Object.entries(frames);
  if (entries.length < 3) return {};
  const pos = axis === 'x' ? (f: Rect) => f.x : (f: Rect) => f.y;
  const size = axis === 'x' ? (f: Rect) => f.w : (f: Rect) => f.h;
  entries.sort(([, a], [, b]) => pos(a) - pos(b));
  const first = entries[0]![1];
  const last = entries[entries.length - 1]![1];
  const span = pos(last) + size(last) - pos(first);
  const total = entries.reduce((sum, [, f]) => sum + size(f), 0);
  const gap = (span - total) / (entries.length - 1);
  const out: Record<string, { x?: number; y?: number }> = {};
  let cursor = pos(first);
  for (const [id, f] of entries) {
    out[id] = axis === 'x' ? { x: cursor } : { y: cursor };
    cursor += size(f) + gap;
  }
  return out;
}

export interface OverflowIssue {
  elementId: string;
  kind: 'off-slide' | 'text-overflow' | 'overlap';
  message: string;
}

/** Elements outside the slide, plus text taller than its box. `textHeights` is measured by the caller. */
export function findLayoutIssues(
  elements: { id: string; frame: Frame; type: string }[],
  page: { width: number; height: number },
  textHeights: Record<string, number> = {},
): OverflowIssue[] {
  const issues: OverflowIssue[] = [];
  for (const el of elements) {
    const b = rotatedBounds(el.frame);
    const tol = 1;
    if (b.x < -tol || b.y < -tol || b.x + b.w > page.width + tol || b.y + b.h > page.height + tol) {
      const side =
        b.x + b.w > page.width + tol
          ? '오른쪽'
          : b.y + b.h > page.height + tol
            ? '아래쪽'
            : b.x < -tol
              ? '왼쪽'
              : '위쪽';
      issues.push({
        elementId: el.id,
        kind: 'off-slide',
        message: `슬라이드 ${side} 경계를 넘었습니다.`,
      });
    }
    const textH = textHeights[el.id];
    if (textH !== undefined && textH > el.frame.h + 2) {
      issues.push({
        elementId: el.id,
        kind: 'text-overflow',
        message: `글자가 상자보다 ${Math.round(textH - el.frame.h)}px 깁니다.`,
      });
    }
  }
  return issues;
}

/** Fit a slide into an area; the result only ever goes into a CSS transform. */
export const fitZoom = (
  page: { width: number; height: number },
  area: { width: number; height: number },
  padding = 32,
): number =>
  Math.max(
    0.05,
    Math.min((area.width - padding * 2) / page.width, (area.height - padding * 2) / page.height),
  );
