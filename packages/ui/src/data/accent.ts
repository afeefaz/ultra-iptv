import type { MessageKey } from '../i18n';

export interface AccentColor {
  /** Saved as the setting, and read as it is by the splash screen in index.html. */
  hex: string;
  /** A lighter shade, for small text and highlights on the dark background. */
  light: string;
  name: MessageKey;
}

export const DEFAULT_ACCENT = '#f59e0b';

/** Presets, not a free choice: each is checked for contrast in accent.test.ts, and a remote can reach them all. */
export const ACCENT_COLORS: AccentColor[] = [
  { hex: DEFAULT_ACCENT, light: '#fbbf24', name: 'settings.color.amber' },
  { hex: '#ef4444', light: '#f87171', name: 'settings.color.red' },
  { hex: '#ec4899', light: '#f472b6', name: 'settings.color.pink' },
  { hex: '#a855f7', light: '#c084fc', name: 'settings.color.purple' },
  { hex: '#3b82f6', light: '#60a5fa', name: 'settings.color.blue' },
  { hex: '#14b8a6', light: '#2dd4bf', name: 'settings.color.teal' },
  { hex: '#22c55e', light: '#4ade80', name: 'settings.color.green' },
  { hex: '#cbd5e1', light: '#e2e8f0', name: 'settings.color.silver' },
];

/** The saved value can come from another device through sync, so an unknown one falls back. */
export function accentColor(hex: string): AccentColor {
  return ACCENT_COLORS.filter((c) => c.hex === hex)[0] ?? ACCENT_COLORS[0];
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The CSS variables a colour sets. Chrome 53 has no color-mix, so the see-through ones are worked out here. */
export function accentVariables(color: AccentColor): Record<string, string> {
  const channels = rgb(color.hex).join(', ');
  return {
    '--accent': color.hex,
    '--accent-light': color.light,
    '--accent-soft': `rgba(${channels}, 0.16)`,
    '--accent-ring': `rgba(${channels}, 0.5)`,
    '--glow': `0 0 1.5rem rgba(${channels}, 0.45)`,
  };
}

/** WCAG contrast ratio of two colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = rgb(hex).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
