import { describe, expect, it } from 'vitest';
import { toKey } from './keymap';

describe('toKey', () => {
  it('maps key names', () => {
    expect(toKey({ key: 'ArrowLeft' })).toBe('left');
    expect(toKey({ key: 'Enter' })).toBe('ok');
    expect(toKey({ key: 'Escape' })).toBe('back');
    expect(toKey({ key: 'F3' })).toBe('yellow');
    expect(toKey({ key: '7' })).toBe('digit7');
  });

  it('falls back to keyCodes when key is missing or Unidentified', () => {
    expect(toKey({ key: 'Unidentified', keyCode: 10009 })).toBe('back');
    expect(toKey({ keyCode: 461 })).toBe('back');
    expect(toKey({ keyCode: 405 })).toBe('yellow');
    expect(toKey({ keyCode: 427 })).toBe('chUp');
    expect(toKey({ keyCode: 101 })).toBe('digit5');
  });

  it('ignores unrelated keys', () => {
    expect(toKey({ key: 'a', keyCode: 65 })).toBeNull();
  });
});
