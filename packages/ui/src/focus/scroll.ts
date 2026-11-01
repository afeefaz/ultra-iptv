const SCROLLABLE = /(auto|scroll)/;

/**
 * Scrolls every scrollable ancestor just enough to show `el` with a margin.
 * Relative adjustments keep this correct for both old and new RTL scrollLeft models.
 */
export function ensureVisible(el: HTMLElement, margin = 24): void {
  let parent = el.parentElement;
  while (parent && parent !== document.body) {
    const style = getComputedStyle(parent);
    const canY = SCROLLABLE.test(style.overflowY) && parent.scrollHeight > parent.clientHeight;
    const canX = SCROLLABLE.test(style.overflowX) && parent.scrollWidth > parent.clientWidth;
    if (canY || canX) {
      const box = parent.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (canY) {
        if (r.top < box.top + margin) parent.scrollTop -= box.top + margin - r.top;
        else if (r.bottom > box.bottom - margin) parent.scrollTop += r.bottom - (box.bottom - margin);
      }
      if (canX) {
        if (r.left < box.left + margin) parent.scrollLeft -= box.left + margin - r.left;
        else if (r.right > box.right - margin) parent.scrollLeft += r.right - (box.right - margin);
      }
    }
    parent = parent.parentElement;
  }
}
