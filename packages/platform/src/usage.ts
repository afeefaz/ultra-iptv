interface ChromeMemory {
  usedJSHeapSize?: number;
}

/** The page's JavaScript memory; Chromium only, and it doesn't include video buffers. */
export function jsHeapUsed(): number | undefined {
  return (performance as unknown as { memory?: ChromeMemory }).memory?.usedJSHeapSize;
}
