import { describe, expect, it } from 'vitest';
import { runSpeedTest, SpeedTestCancelled, toMbps, type DownloadFn, type DownloadResult } from './speed';

const answer = (over: Partial<DownloadResult>): DownloadResult => ({ status: 200, ttfbMs: 20, bytes: 0, ms: 0, compressed: false, ...over });
const MB = 1024 * 1024;

describe('runSpeedTest', () => {
  it('uses the fastest response as the ping and averages the data', async () => {
    const pings = [40, 25, 30];
    const download: DownloadFn = async (_, { seconds, onProgress }) => {
      if (seconds === 0) return answer({ ttfbMs: pings.shift()! });
      onProgress?.(5 * MB, 2000);
      return answer({ bytes: 25 * MB, ms: 10_000 });
    };
    const r = await runSpeedTest({ ping: 'p', downloads: [{ url: 'm', kind: 'media' }] }, download, { seconds: 10 });
    expect(r.pingMs).toBe(25);
    expect(r.mbps).toBeCloseTo(toMbps(25 * MB, 10_000));
    expect(r.estimate).toBe(false);
    expect(r.bytes).toBe(25 * MB);
  });

  it('keeps downloading until the time is used up when a file ends early', async () => {
    let calls = 0;
    const download: DownloadFn = async (_, { seconds }) => {
      if (seconds === 0) return answer({});
      calls++;
      return answer({ bytes: 10 * MB, ms: 4000 });
    };
    const r = await runSpeedTest({ ping: 'p', downloads: [{ url: 'm', kind: 'media' }] }, download, { seconds: 10 });
    expect(calls).toBe(3);
    expect(r.bytes).toBe(30 * MB);
  });

  it('skips a broken or tiny video and marks a catalogue result as an estimate', async () => {
    const download: DownloadFn = async (url, { seconds }) => {
      if (seconds === 0) return answer({});
      if (url === 'bad') return answer({ status: 404 });
      if (url === 'tiny') return answer({ bytes: 1000, ms: 5 });
      return answer({ bytes: 20 * MB, ms: 10_000, compressed: true });
    };
    const r = await runSpeedTest(
      {
        ping: 'p',
        downloads: [
          { url: 'bad', kind: 'media' },
          { url: 'tiny', kind: 'media' },
          { url: 'list', kind: 'catalog' },
        ],
      },
      download,
      { seconds: 10 },
    );
    expect(r.bytes).toBe(20 * MB);
    expect(r.estimate).toBe(true);
  });

  it('counts a short read when the time ran out, instead of giving up on the video', async () => {
    let calls = 0;
    const download: DownloadFn = async (_, { seconds }) => {
      if (seconds === 0) return answer({});
      calls++;
      // A 3 MB file read repeatedly; the last read only gets the few milliseconds left.
      return calls < 3 ? answer({ bytes: 3 * MB, ms: 4990 }) : answer({ bytes: 1000, ms: seconds * 1000 });
    };
    const r = await runSpeedTest(
      {
        ping: 'p',
        downloads: [
          { url: 'm', kind: 'media' },
          { url: 'list', kind: 'catalog' },
        ],
      },
      download,
      { seconds: 10 },
    );
    expect(calls).toBe(3);
    expect(r.estimate).toBe(false);
  });

  it('fails with the reason when nothing could be read', async () => {
    const download: DownloadFn = async () => {
      throw new Error('blocked');
    };
    await expect(runSpeedTest({ ping: 'p', downloads: [{ url: 'm', kind: 'media' }] }, download, { seconds: 10 })).rejects.toThrow('blocked');
  });

  it('stops when cancelled', async () => {
    const download: DownloadFn = async () => answer({});
    await expect(runSpeedTest({ ping: 'p', downloads: [] }, download, { seconds: 10, isCancelled: () => true })).rejects.toBeInstanceOf(SpeedTestCancelled);
  });
});
