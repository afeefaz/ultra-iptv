// A section processed in its own worker (catalogue in files, TVs): downloaded, parsed, built and
// turned into file text there, so it runs on another core while the catalogue worker does the
// rest. Only finished text comes back. The catalogue worker writes it and commits.
import { AppError, toErrorInfo } from '../net/http';
import { XtreamApi, type XtreamCategory, type XtreamCreds, type XtreamSeries, type XtreamVodStream } from '../sources/xtream';
import { buildXtreamSeries, buildXtreamVod, unsigned } from './build';
import { encodeSection, type EncodedSection } from './fileStore';
import { hash64 } from './hash';
import type { ErrorInfo, FavoriteRow } from './model';

export interface SectionJob {
  playlistId: string;
  kind: 'vod' | 'series';
  creds: XtreamCreds;
  headers?: Record<string, string>;
  /** The category list, already downloaded by the catalogue worker: one connection less. */
  catsText: string;
  /** The last refresh's list hash, when there is one to compare with; none on a first load. */
  previousHash?: string;
  hashVersion: number;
  favorites: FavoriteRow[];
}

/** From the section worker. */
export type SectionMessage =
  | { type: 'downloaded' }
  | { type: 'estimate'; bytes: number }
  | { type: 'batch'; text: string; start: boolean }
  | { type: 'unchanged' }
  | { type: 'done'; encoded: EncodedSection; hash?: string; ms: Record<string, number> }
  | { type: 'error'; error: ErrorInfo };

/** To the section worker. */
export type SectionReply = { type: 'job'; job: SectionJob } | { type: 'ack' } | { type: 'go' } | { type: 'stop'; error: ErrorInfo };

const ACTIONS = {
  vod: ['get_vod_categories', 'get_vod_streams'],
  series: ['get_series_categories', 'get_series'],
} as const;

/** Runs one job; `send` posts to the catalogue worker, `next` waits for its next reply. */
export async function runSectionJob(job: SectionJob, send: (m: SectionMessage) => void, next: () => Promise<SectionReply>): Promise<void> {
  const ms: Record<string, number> = {};
  const timed = <T>(name: string, fn: () => T): T => {
    const t = Date.now();
    try {
      return fn();
    } finally {
      ms[name] = Date.now() - t;
    }
  };
  try {
    const api = new XtreamApi(job.creds, { headers: job.headers });
    const [catAction, listAction] = ACTIONS[job.kind];
    const t0 = Date.now();
    // Only the big list: providers limit how many connections an account may have open at once.
    const catsText = job.catsText;
    const itemsText = await api.rawList(listAction);
    ms.download = Date.now() - t0;
    send({ type: 'downloaded' });
    let hash: string | undefined;
    if (job.previousHash !== undefined) {
      hash = timed('hash', () => `${job.hashVersion}|${hash64(catsText)}|${hash64(itemsText)}`);
      if (hash === job.previousHash) {
        send({ type: 'unchanged' });
        return;
      }
    }
    const cats = timed('parseCats', () => api.parseList<XtreamCategory>(catAction, catsText));
    const built = timed('build', () =>
      unsigned(() =>
        job.kind === 'vod'
          ? buildXtreamVod(job.playlistId, cats, timed('parse', () => api.parseList<XtreamVodStream>(listAction, itemsText)))
          : buildXtreamSeries(job.playlistId, cats, timed('parse', () => api.parseList<XtreamSeries>(listAction, itemsText))),
      ),
    );
    const t1 = Date.now();
    const encoded = await encodeSection(
      job.kind,
      built,
      job.favorites,
      async (bytes) => {
        send({ type: 'estimate', bytes });
        const reply = await next();
        if (reply.type === 'stop') throw new AppError(reply.error);
      },
      async (text, start) => {
        send({ type: 'batch', text, start });
        // One batch in flight: the catalogue worker says when it's taken it.
        await next();
      },
    );
    ms.encode = Date.now() - t1;
    send({ type: 'done', encoded, hash, ms });
  } catch (e) {
    send({ type: 'error', error: toErrorInfo(e) });
  }
}
