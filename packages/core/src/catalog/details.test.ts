import { describe, expect, it } from 'vitest';
import { youtubeId } from './details';

describe('youtubeId', () => {
  it('takes a bare id', () => {
    expect(youtubeId('aqz-KE-bpKQ')).toBe('aqz-KE-bpKQ');
    expect(youtubeId('  aqz-KE-bpKQ ')).toBe('aqz-KE-bpKQ');
  });

  it('finds the id in YouTube links', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=aqz-KE-bpKQ')).toBe('aqz-KE-bpKQ');
    expect(youtubeId('https://www.youtube.com/watch?feature=share&v=aqz-KE-bpKQ&t=10')).toBe('aqz-KE-bpKQ');
    expect(youtubeId('http://youtu.be/aqz-KE-bpKQ')).toBe('aqz-KE-bpKQ');
    expect(youtubeId('https://www.youtube.com/embed/aqz-KE-bpKQ?rel=0')).toBe('aqz-KE-bpKQ');
  });

  it('gives null for anything else', () => {
    expect(youtubeId(undefined)).toBeNull();
    expect(youtubeId('')).toBeNull();
    expect(youtubeId('The Movie Trailer')).toBeNull();
    expect(youtubeId('https://vimeo.com/123456789')).toBeNull();
    expect(youtubeId('https://www.youtube.com/watch?v=short')).toBeNull();
  });
});
