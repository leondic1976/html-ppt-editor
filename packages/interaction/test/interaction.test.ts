import { describe, expect, it } from 'vitest';
import {
  alignFrames,
  computeSnap,
  distributeFrames,
  findLayoutIssues,
  fitZoom,
  resizeFrame,
  rotatedBounds,
  rotationFromPointer,
  screenToModel,
} from '@hps/interaction';

const f = { x: 100, y: 100, w: 200, h: 100, rotate: 0 };

describe('resize', () => {
  it('east grows width only', () => {
    expect(resizeFrame(f, 'e', 50, 999)).toMatchObject({ x: 100, y: 100, w: 250, h: 100 });
  });
  it('north-west moves origin and keeps the opposite corner', () => {
    const r = resizeFrame(f, 'nw', -10, -20);
    expect(r).toMatchObject({ x: 90, y: 80, w: 210, h: 120 });
    expect(r.x + r.w).toBe(f.x + f.w);
    expect(r.y + r.h).toBe(f.y + f.h);
  });
  it('keeps the aspect ratio', () => {
    const r = resizeFrame(f, 'se', 100, 0, { keepRatio: true });
    expect(r.w / r.h).toBeCloseTo(2);
    expect(r.w).toBe(300);
  });
  it('resizes from centre', () => {
    const r = resizeFrame(f, 'e', 10, 0, { fromCenter: true });
    expect(r).toMatchObject({ x: 90, w: 220 });
  });
  it('respects the minimum size', () => {
    expect(resizeFrame(f, 'se', -1000, -1000).w).toBe(8);
  });
  it('on a rotated frame keeps the opposite corner fixed on screen', () => {
    const rot = { ...f, rotate: 90 };
    const corner = (fr: typeof f, sx: number, sy: number) => {
      const rad = (fr.rotate * Math.PI) / 180;
      const lx = (sx * fr.w) / 2;
      const ly = (sy * fr.h) / 2;
      return {
        x: fr.x + fr.w / 2 + lx * Math.cos(rad) - ly * Math.sin(rad),
        y: fr.y + fr.h / 2 + lx * Math.sin(rad) + ly * Math.cos(rad),
      };
    };
    const before = corner(rot, -1, -1);
    const after = corner(resizeFrame(rot, 'se', 30, 40), -1, -1);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
});

describe('rotation', () => {
  it('pointer above the centre is 0deg, and steps snap', () => {
    expect(rotationFromPointer({ x: 0, y: 0, w: 100, h: 100 }, 50, -50)).toBeCloseTo(0);
    expect(rotationFromPointer({ x: 0, y: 0, w: 100, h: 100 }, 150, 50)).toBeCloseTo(90);
    expect(rotationFromPointer({ x: 0, y: 0, w: 100, h: 100 }, 150, 40, 15)).toBeCloseTo(90);
  });
  it('rotated bounds', () => {
    const b = rotatedBounds({ ...f, rotate: 90 });
    expect(b.w).toBeCloseTo(100);
    expect(b.h).toBeCloseTo(200);
  });
});

describe('snap', () => {
  const page = { width: 1920, height: 1080 };
  it('snaps to the slide centre', () => {
    const r = computeSnap({
      moving: { x: 856, y: 10, w: 200, h: 100 },
      others: [],
      page,
      threshold: 6,
    });
    expect(r.dx).toBe(4);
    expect(r.guides[0]).toMatchObject({ axis: 'x', at: 960, kind: 'slide' });
  });
  it('snaps to other elements', () => {
    const r = computeSnap({
      moving: { x: 303, y: 500, w: 100, h: 50 },
      others: [{ x: 100, y: 800, w: 200, h: 50 }],
      page,
      threshold: 5,
    });
    expect(r.dx).toBe(-3);
    expect(r.guides[0]!.kind).toBe('element');
  });
  it('does nothing out of range', () => {
    expect(
      computeSnap({ moving: { x: 300, y: 300, w: 10, h: 10 }, others: [], page, threshold: 2 }),
    ).toMatchObject({ dx: 0, dy: 0, guides: [] });
  });
});

describe('align and distribute', () => {
  const page = { width: 1000, height: 500 };
  const frames = { a: { x: 0, y: 0, w: 100, h: 100 }, b: { x: 300, y: 50, w: 100, h: 100 } };
  it('aligns to selection bounds', () => {
    expect(alignFrames(frames, 'right', page)).toEqual({ a: { x: 300 }, b: { x: 300 } });
    expect(alignFrames(frames, 'bottom', page).a).toEqual({ y: 50 });
  });
  it('aligns one element to the slide', () => {
    expect(alignFrames({ a: frames.a }, 'hcenter', page).a).toEqual({ x: 450 });
  });
  it('distributes with equal gaps and fixed ends', () => {
    const r = distributeFrames(
      {
        a: { x: 0, y: 0, w: 100, h: 10 },
        b: { x: 110, y: 0, w: 100, h: 10 },
        c: { x: 900, y: 0, w: 100, h: 10 },
      },
      'x',
    );
    expect(r).toEqual({ a: { x: 0 }, b: { x: 450 }, c: { x: 900 } });
  });
  it('needs three', () => {
    expect(distributeFrames(frames, 'x')).toEqual({});
  });
});

describe('layout checks', () => {
  const page = { width: 100, height: 100 };
  it('finds off-slide elements and text overflow', () => {
    const issues = findLayoutIssues(
      [
        { id: 'a', type: 'shape', frame: { x: 90, y: 0, w: 50, h: 10, rotate: 0 } },
        { id: 'b', type: 'text', frame: { x: 0, y: 0, w: 50, h: 10, rotate: 0 } },
        { id: 'ok', type: 'shape', frame: { x: 0, y: 0, w: 50, h: 10, rotate: 0 } },
      ],
      page,
      { b: 40 },
    );
    expect(issues.map((i) => [i.elementId, i.kind])).toEqual([
      ['a', 'off-slide'],
      ['b', 'text-overflow'],
    ]);
  });
});

describe('zoom', () => {
  it('model coordinates are independent of zoom', () => {
    expect(screenToModel(100, 0.5)).toBe(200);
    expect(fitZoom({ width: 1920, height: 1080 }, { width: 1024, height: 2000 }, 32)).toBeCloseTo(
      960 / 1920,
    );
  });
});
