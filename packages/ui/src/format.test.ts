import { describe, expect, it } from 'vitest';
import { resolutionLabel } from './format';

describe('resolutionLabel', () => {
  it('names common sizes', () => {
    expect(resolutionLabel(3840, 2160)).toBe('4K');
    expect(resolutionLabel(1920, 1080)).toBe('1080p');
    expect(resolutionLabel(1280, 720)).toBe('720p');
    expect(resolutionLabel(720, 576)).toBe('576p');
  });

  it('goes by width for wide pictures', () => {
    expect(resolutionLabel(1920, 800)).toBe('1080p');
    expect(resolutionLabel(3840, 1600)).toBe('4K');
    expect(resolutionLabel(1280, 536)).toBe('720p');
  });
});
