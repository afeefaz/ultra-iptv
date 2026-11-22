import { describe, expect, it, vi } from 'vitest';

vi.mock('./catalog', () => ({ catalog: () => ({ call: async () => undefined }) }));
vi.mock('./playlists', () => ({ activePlaylist: () => null }));

const { isSyncedSetting } = await import('./syncAccess');

describe('isSyncedSetting', () => {
  it('carries the app settings to the other devices', () => {
    expect(isSyncedSetting('ultraiptv.display.theme')).toBe(true);
    expect(isSyncedSetting('ultraiptv.playback.pictureFit')).toBe(true);
  });

  it("keeps a phone's screen orientation to itself", () => {
    expect(isSyncedSetting('ultraiptv.display.orientation')).toBe(false);
  });

  it('leaves out what is not a setting', () => {
    expect(isSyncedSetting('ultraiptv.log.salt')).toBe(false);
    expect(isSyncedSetting('ultra.devPortrait')).toBe(false);
  });
});
