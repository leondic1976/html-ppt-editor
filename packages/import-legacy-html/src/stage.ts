/**
 * Helpers the editor (parent realm) uses on the sandboxed preview document.
 * All of this touches the preview DOM only; saved files come from source patches.
 */

/** Classes decks commonly toggle from script to reveal the current slide. */
const ACTIVE_CLASSES = ['active', 'current', 'present', 'is-active', 'visible', 'show'];

export interface SlideBox {
  width: number;
  height: number;
}

export const elementById = (doc: Document, id: string): HTMLElement | null =>
  doc.querySelector<HTMLElement>(`[data-hps-id="${CSS.escape(id)}"]`);

/** Show one slide and hide its peers, without changing any slide's own layout mode. */
export function showSlide(doc: Document, slideIds: string[], current: number): HTMLElement | null {
  let shown: HTMLElement | null = null;
  slideIds.forEach((id, i) => {
    const el = elementById(doc, id);
    if (!el) return;
    if (i !== current) {
      el.setAttribute('data-hps-hidden', '');
      el.removeAttribute('data-hps-current');
      return;
    }
    el.removeAttribute('data-hps-hidden');
    el.setAttribute('data-hps-current', '');
    shown = el;
  });
  if (!shown) return null;
  const el = shown as HTMLElement;
  const win = doc.defaultView!;
  if (
    win.getComputedStyle(el).display === 'none' ||
    win.getComputedStyle(el).visibility === 'hidden'
  ) {
    // Script-driven decks hide inactive slides by class. Without their script, supply the class.
    el.classList.add(...ACTIVE_CLASSES);
    if (win.getComputedStyle(el).display === 'none')
      el.style.setProperty('display', 'block', 'important');
  }
  return el;
}

/** Design size of a slide: measured at the frame's current viewport, floored to something usable. */
export function measureSlide(el: HTMLElement): SlideBox {
  const r = el.getBoundingClientRect();
  return { width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) };
}

/** Nearest indexed ancestor (or self) of a click target that the index says can be edited. */
export function pickEditable(
  target: Element | null,
  isEditable: (id: string) => boolean,
): { id: string; el: HTMLElement } | null {
  for (let cur: Element | null = target; cur; cur = cur.parentElement) {
    const id = cur.getAttribute('data-hps-id');
    if (id && isEditable(id)) return { id, el: cur as HTMLElement };
  }
  return null;
}

/** Ids matched by a user-supplied CSS selector, for manual slide division. */
export function idsForSelector(doc: Document, selector: string): string[] {
  return [...doc.querySelectorAll(selector)]
    .map((el) => el.getAttribute('data-hps-id'))
    .filter((id): id is string => !!id);
}

/** Text after a contentEditable session, as either plain text or inline markup. */
export function readEditedBlock(el: HTMLElement): { text: string } | { html: string } {
  const hasElements = [...el.childNodes].some(
    (n) => n.nodeType === 1 && (n as Element).tagName !== 'BR',
  );
  const clone = el.cloneNode(true) as HTMLElement;
  for (const node of clone.querySelectorAll('*')) {
    for (const a of [...node.attributes]) {
      if (a.name.startsWith('data-hps-')) node.removeAttribute(a.name);
    }
  }
  if (!hasElements && !clone.querySelector('br')) return { text: clone.textContent ?? '' };
  return { html: clone.innerHTML };
}
