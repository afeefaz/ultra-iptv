/** Class on <html> while native video plays full screen under the page (the page must be transparent). */
export const VIDEO_BEHIND_CLASS = 'video-behind';

/** Class on <html> while the Live preview shows video through a hole in the page. */
export const VIDEO_HOLE_CLASS = 'video-hole';

/** Keeps the page opaque around the hole: see `.video-hole-frame`. */
export function createHoleFrame(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'video-hole-frame';
  el.style.display = 'none';
  document.body.appendChild(el);
  return el;
}

export function placeBox(el: HTMLElement, box: { left: number; top: number; width: number; height: number }): void {
  el.style.left = `${box.left}px`;
  el.style.top = `${box.top}px`;
  el.style.width = `${box.width}px`;
  el.style.height = `${box.height}px`;
}
