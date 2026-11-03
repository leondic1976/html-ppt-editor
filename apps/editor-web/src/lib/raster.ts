import { toPng } from 'html-to-image';
import type { DeckDocument, Slide, SlideElement } from '@hps/document-core';
import { contextFor, deckCss, renderElementInner, renderSlide } from '@hps/slide-renderer';

/**
 * Pictures of slides, in the browser (foreignObject + canvas). System fonts render; fonts only
 * reachable over the network and pictures from other origins do not, and the report says so.
 */
export async function captureElement(
  el: HTMLElement,
  width: number,
  height: number,
): Promise<string | null> {
  try {
    const url = await toPng(el, {
      width,
      height,
      pixelRatio: 1,
      cacheBust: false,
      skipFonts: true,
      style: { margin: '0', transform: 'none' },
    });
    return url.length > 100 ? url : null;
  } catch {
    return null;
  }
}

function offscreenHost(doc: DeckDocument): HTMLDivElement {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${doc.page.width}px;height:${doc.page.height}px;pointer-events:none`;
  const style = document.createElement('style');
  style.textContent = deckCss(doc.page);
  host.appendChild(style);
  document.body.appendChild(host);
  return host;
}

const settle = async (root: HTMLElement): Promise<void> => {
  await Promise.all(
    [...root.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)),
  );
  await document.fonts?.ready;
};

export async function rasterizeSlide(
  doc: DeckDocument,
  assets: Map<string, string>,
  slide: Slide,
): Promise<string | null> {
  const host = offscreenHost(doc);
  try {
    const wrap = document.createElement('div');
    wrap.innerHTML = renderSlide(
      slide,
      contextFor(doc, { mode: 'src', url: (id) => assets.get(id) }),
    );
    host.appendChild(wrap);
    await settle(wrap);
    return await captureElement(
      wrap.firstElementChild as HTMLElement,
      doc.page.width,
      doc.page.height,
    );
  } finally {
    host.remove();
  }
}

export async function rasterizeElement(
  doc: DeckDocument,
  assets: Map<string, string>,
  el: SlideElement,
): Promise<string | null> {
  const host = offscreenHost(doc);
  try {
    const wrap = document.createElement('div');
    wrap.style.cssText = `width:${el.frame.w}px;height:${el.frame.h}px;position:relative`;
    wrap.innerHTML = renderElementInner(
      el,
      contextFor(doc, { mode: 'src', url: (id) => assets.get(id) }),
    );
    host.appendChild(wrap);
    await settle(wrap);
    return await captureElement(wrap, Math.max(1, el.frame.w), Math.max(1, el.frame.h));
  } finally {
    host.remove();
  }
}

/** Decode any browser-readable picture and re-encode as PNG (WebP/AVIF/BMP/SVG for PPTX). */
export async function reencodePng(dataUrl: string): Promise<string | null> {
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || 1024;
    canvas.height = img.naturalHeight || 1024;
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

export async function decodeImageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return { width: img.naturalWidth || 1024, height: img.naturalHeight || 1024 };
}
