import { describe, expect, it } from 'vitest';
import { formatBitrate, formatBytes, resolutionLabel } from './format';

describe('formatBitrate', () => {
  it('uses megabits from 1000 kbps', () => {
    expect(formatBitrate(5240)).toBe('5.2 Mbps');
    expect(formatBitrate(1000)).toBe('1.0 Mbps');
    expect(formatBitrate(849.6)).toBe('850 kbps');
  });
});

describe('formatBytes', () => {
  it('shows enough digits to see it change', () => {
    expect(formatBytes(1.5 * 1024 ** 3, 'GB')).toBe('1.50 GB');
    expect(formatBytes(52.25 * 1024 ** 2, 'MB')).toBe('52.3 MB');
    expect(formatBytes(182.4 * 1024 ** 2, 'MB')).toBe('182 MB');
  });
});

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
