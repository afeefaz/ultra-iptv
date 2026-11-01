import { describe, expect, it } from 'vitest';
import { normalizeServer, parseXtreamUrl } from './xtream';

describe('normalizeServer', () => {
  it.each([
    ['host.tv:8080', 'http://host.tv:8080'],
    ['http://host.tv:8080/', 'http://host.tv:8080'],
    ['https://host.tv/player_api.php', 'https://host.tv'],
    ['http://host.tv/sub/get.php', 'http://host.tv/sub'],
    ['  HTTP://Host.TV  ', 'http://host.tv'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeServer(input)).toBe(expected);
  });

  it('rejects empty and non-http input', () => {
    expect(() => normalizeServer('')).toThrow(/empty/);
    expect(() => normalizeServer('ftp://x')).toThrow(/http/);
  });
});

describe('parseXtreamUrl', () => {
  it('reads get.php and player_api.php by parameter name, in any order', () => {
    expect(parseXtreamUrl('http://h.tv:8080/get.php?type=m3u_plus&password=p%40ss&username=al&output=ts')).toEqual({
      server: 'http://h.tv:8080',
      username: 'al',
      password: 'p@ss',
    });
    expect(parseXtreamUrl('h.tv/player_api.php?username=a&password=b')).toEqual({
      server: 'http://h.tv',
      username: 'a',
      password: 'b',
    });
  });

  it('reads /playlist/<u>/<p>/ URLs', () => {
    expect(parseXtreamUrl('http://h.tv/playlist/al/pw/m3u_plus')).toEqual({ server: 'http://h.tv', username: 'al', password: 'pw' });
  });

  it('returns null for plain M3U URLs', () => {
    expect(parseXtreamUrl('https://cdn.example/list.m3u')).toBeNull();
    expect(parseXtreamUrl('http://h.tv/get.php?username=a')).toBeNull();
  });
});
