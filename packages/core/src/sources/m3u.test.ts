import { describe, expect, it } from 'vitest';
import { M3uParser, parseExtinf, type M3uEntry } from './m3u';

function parse(text: string, chunkSize = text.length): { entries: M3uEntry[]; parser: M3uParser } {
  const entries: M3uEntry[] = [];
  const parser = new M3uParser((e) => entries.push(e));
  for (let i = 0; i < text.length; i += chunkSize) parser.push(text.slice(i, i + chunkSize));
  parser.end();
  return { entries, parser };
}

const SAMPLE = [
  '\uFEFF#EXTM3U url-tvg="http://epg.example/guide.xml" x-tvg-url="http://b/x.xml"',
  '#EXTINF:-1 tvg-id="bbc1.uk" tvg-name="BBC One" tvg-logo="http://l/bbc.png" group-title="UK, General",BBC One HD',
  'http://p.example/live/u1/p1/101.ts',
  '#EXTINF:-1 tvg-id=noquotes group-title=\'Single Quoted\',Title, with comma',
  '#EXTVLCOPT:http-user-agent=Mozilla/5.0 Test',
  '#EXTVLCOPT:http-referrer=http://ref.example/',
  '#KODIPROP:inputstream.adaptive.license_type=clearkey',
  'http://p.example/live/u1/p1/102.ts',
  '#EXTINF:0,No Group',
  '#EXTGRP:From EXTGRP',
  'http://p.example/movie/u1/p1/5.mkv',
  'http://bare.example/stream.m3u8',
].join('\r\n');

describe('M3uParser', () => {
  it('parses header, attributes, titles and per-entry options', () => {
    const { entries, parser } = parse(SAMPLE);
    expect(parser.sawHeader).toBe(true);
    expect(parser.header['url-tvg']).toBe('http://epg.example/guide.xml');
    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({
      name: 'BBC One HD',
      url: 'http://p.example/live/u1/p1/101.ts',
      duration: -1,
      attrs: { 'tvg-id': 'bbc1.uk', 'tvg-logo': 'http://l/bbc.png', 'group-title': 'UK, General' },
    });
    expect(entries[1]).toMatchObject({
      name: 'Title, with comma',
      attrs: { 'tvg-id': 'noquotes', 'group-title': 'Single Quoted' },
      userAgent: 'Mozilla/5.0 Test',
      referrer: 'http://ref.example/',
    });
    expect(entries[2]).toMatchObject({ name: 'No Group', group: 'From EXTGRP' });
    expect(entries[2].userAgent).toBeUndefined();
    expect(entries[3]).toMatchObject({ name: 'stream.m3u8', url: 'http://bare.example/stream.m3u8' });
  });

  it('gives the same result however the text is chunked', () => {
    const whole = parse(SAMPLE).entries;
    for (const size of [1, 3, 7, 64]) expect(parse(SAMPLE, size).entries).toEqual(whole);
  });

  it('falls back to tvg-name when the title is empty', () => {
    expect(parseExtinf('-1 tvg-name="Named",').title).toBe('');
    const { entries } = parse('#EXTM3U\n#EXTINF:-1 tvg-name="Named",\nhttp://x/1.ts\n');
    expect(entries[0].name).toBe('Named');
  });

  it('handles a file without trailing newline or header', () => {
    const { entries, parser } = parse('#EXTINF:-1,One\nhttp://x/1.ts');
    expect(parser.sawHeader).toBe(false);
    expect(entries.map((e) => e.name)).toEqual(['One']);
  });
});
