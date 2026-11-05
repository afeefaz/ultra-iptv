// Deterministic fake IPTV provider for unit tests and the dev server (apps/web/dev/fixtures.ts).
// Never imported by app code, so it is not part of any build.

export interface MockAccount {
  password: string;
  live: number;
  liveCategories: number;
  vod: number;
  series: number;
  delayMs: number;
}

export const MOCK_ACCOUNTS: Record<string, MockAccount> = {
  demo: { password: 'demo', live: 300, liveCategories: 12, vod: 200, series: 60, delayMs: 0 },
  big: { password: 'big', live: 50000, liveCategories: 400, vod: 20000, series: 3000, delayMs: 0 },
  slow: { password: 'slow', live: 300, liveCategories: 12, vod: 200, series: 60, delayMs: 2500 },
};

const GENRES = ['News', 'Sports', 'Movies', 'Kids', 'Documentary', 'Music', 'Entertainment', 'أخبار', 'رياضة', 'أطفال', 'وثائقي', 'Local'];
const COUNTRIES = ['UK', 'US', 'FR', 'DE', 'IT', 'ES', 'AR', 'TR', 'IN', 'NL', 'PT', 'PL', 'SE', 'GR', 'RO', 'BR', 'CA', 'AU', 'IL', 'MA'];

function categoryName(i: number, count: number): string {
  const genre = GENRES[i % GENRES.length];
  return count <= GENRES.length ? genre : `${COUNTRIES[Math.floor(i / GENRES.length) % COUNTRIES.length]}| ${genre} ${Math.floor(i / (GENRES.length * COUNTRIES.length)) + 1}`;
}

function channelName(i: number, genre: string): string {
  return /[؀-ۿ]/.test(genre) ? `قناة ${genre} ${i + 1}` : `${genre} ${i + 1} HD`;
}

/** Generation > 0: every id shifts, ~1% of channels disappear and a few new ones appear. */
function liveRows(acc: MockAccount, generation: number, origin: string) {
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < acc.live; i++) {
    if (generation > 0 && i % 97 === 5) continue;
    const cat = i % acc.liveCategories;
    const genre = GENRES[cat % GENRES.length];
    rows.push({
      num: i + 1,
      name: channelName(i, genre),
      stream_type: 'live',
      stream_id: 1000 + i + generation * 100000,
      stream_icon: `${origin}/__fixtures/logo/${i % 50}.svg`,
      epg_channel_id: `ch${i}.fx`,
      added: String(1700000000 + i * 60),
      category_id: String(cat + 1),
      tv_archive: i % 5 === 0 ? 1 : 0,
      tv_archive_duration: i % 5 === 0 ? '3' : '0',
    });
  }
  for (let k = 0; k < generation * 3; k++) {
    rows.push({ num: acc.live + k + 1, name: `New Channel ${generation}-${k + 1}`, stream_id: 900000 + generation * 10 + k, category_id: '1' });
  }
  return rows;
}

function categories(n: number) {
  return Array.from({ length: n }, (_, i) => ({ category_id: String(i + 1), category_name: categoryName(i, n), parent_id: 0 }));
}

export function mockXtream(
  action: string | null,
  username: string,
  password: string,
  generation: number,
  origin: string,
  streamId?: string | null,
  now = Date.now(),
): unknown {
  const acc = MOCK_ACCOUNTS[username];
  if (!acc || acc.password !== password) return { user_info: { auth: 0 } };
  switch (action) {
    case null:
    case '':
      return {
        user_info: { auth: 1, status: 'Active', exp_date: '1893456000', max_connections: '2', active_cons: '0', is_trial: '0' },
        server_info: { url: 'mock', port: '80' },
      };
    case 'get_live_categories':
      return categories(acc.liveCategories);
    case 'get_live_streams':
      return liveRows(acc, generation, origin);
    case 'get_short_epg':
      return { epg_listings: mockShortEpg(streamId ?? '', now) };
    case 'get_simple_data_table':
      return { epg_listings: mockArchive(streamId ?? '', now) };
    case 'get_vod_info':
      return mockVodInfo(streamId ?? '', origin);
    case 'get_series_info':
      return mockSeriesInfo(streamId ?? '', origin);
    case 'get_vod_categories':
      return categories(Math.min(30, acc.liveCategories));
    case 'get_vod_streams':
      return Array.from({ length: acc.vod }, (_, i) => ({
        num: i + 1,
        name: `Movie ${i + 1} (${1980 + (i % 45)})`,
        stream_id: 500000 + i + generation * 100000,
        category_id: String((i % Math.min(30, acc.liveCategories)) + 1),
        container_extension: i % 3 ? 'mp4' : 'mkv',
        rating: String((i % 10) + 0.5),
        added: String(1700000000 + i),
      }));
    case 'get_series_categories':
      return categories(Math.min(20, acc.liveCategories));
    case 'get_series':
      return Array.from({ length: acc.series }, (_, i) => ({
        num: i + 1,
        name: `Series ${i + 1}`,
        series_id: 700000 + i,
        category_id: String((i % Math.min(20, acc.liveCategories)) + 1),
        rating: '7.5',
      }));
    default:
      return { error: 'unknown action' };
  }
}

/** The same catalogue as an M3U file; stream URLs embed the account like real providers do. */
export function mockM3u(username: string, generation: number, origin: string): string | null {
  const acc = MOCK_ACCOUNTS[username];
  if (!acc) return null;
  const lines = [`#EXTM3U url-tvg="${origin}/__fixtures/epg.xml"`];
  const cats = categories(acc.liveCategories);
  for (const row of liveRows(acc, generation, origin)) {
    const cat = cats[Number(row.category_id) - 1];
    lines.push(
      `#EXTINF:-1 tvg-id="${row.epg_channel_id ?? ''}" tvg-name="${row.name}" tvg-logo="${row.stream_icon ?? ''}" group-title="${cat ? cat.category_name : ''}"${row.tv_archive ? ' catchup="xc" catchup-days="3"' : ''},${row.name}`,
      `${origin}/__fixtures/live/${username}/${acc.password}/${row.stream_id}.ts`,
    );
  }
  for (let i = 0; i < Math.min(acc.vod, 50); i++) {
    lines.push(`#EXTINF:-1 group-title="Movies",Movie ${i + 1}`, `${origin}/__fixtures/movie/${username}/${acc.password}/${500000 + i}.mp4`);
  }
  for (let i = 0; i < Math.min(acc.series, 5); i++) {
    for (let ep = 1; ep <= 4; ep++) {
      const season = ep <= 2 ? 1 : 2;
      lines.push(
        `#EXTINF:-1 group-title="Series",Show ${i + 1} S0${season} E0${ep}`,
        `${origin}/__fixtures/series/${username}/${acc.password}/${800000 + i * 100 + ep}.mp4`,
      );
    }
  }
  return lines.join('\n') + '\n';
}

const SHOWS = ['Morning Report', 'Live Match', 'Documentary Hour', 'Cartoon Club', 'Music Mix', 'Evening News', 'نشرة الأخبار', 'برنامج حواري'];
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

/**
 * Xtream-style short EPG: programmes aligned to real time, 30 or 60 min long, base64 titles like
 * real panels. Every 7th channel has no guide, to exercise the "no data" path.
 */
export function mockShortEpg(streamId: string, now: number, limit = 4): Array<Record<string, string>> {
  const index = (Number(streamId) - 1000) % 100000;
  if (!isFinite(index) || index < 0 || index % 7 === 3) return [];
  const slotMs = (index % 2 ? 60 : 30) * 60_000;
  const first = Math.floor(now / slotMs) * slotMs;
  const out: Array<Record<string, string>> = [];
  for (let k = 0; k < limit; k++) {
    const start = first + k * slotMs;
    const show = SHOWS[(index + Math.floor(start / slotMs)) % SHOWS.length];
    out.push({
      id: String(start / 1000),
      epg_id: `ch${index}.fx`,
      title: b64(show),
      description: b64(`${show} on channel ${index + 1}. A mock programme for testing.`),
      start: new Date(start).toISOString().slice(0, 19).replace('T', ' '),
      end: new Date(start + slotMs).toISOString().slice(0, 19).replace('T', ' '),
      start_timestamp: String(start / 1000),
      stop_timestamp: String((start + slotMs) / 1000),
    });
  }
  return out;
}

export function mockLogoSvg(n: number): string {
  const hue = (n * 47) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="16" fill="hsl(${hue},55%,42%)"/><text x="48" y="60" font-family="Arial" font-size="36" font-weight="700" fill="#fff" text-anchor="middle">${n}</text></svg>`;
}

/** Past programmes for catch-up: three days back, same slots and titles as the short EPG. */
export function mockArchive(streamId: string, now: number): Array<Record<string, string>> {
  const index = (Number(streamId) - 1000) % 100000;
  if (!isFinite(index) || index < 0 || index % 5 !== 0) return [];
  const slotMs = (index % 2 ? 60 : 30) * 60_000;
  const from = Math.floor((now - 3 * 24 * 3600_000) / slotMs) * slotMs;
  const out: Array<Record<string, string>> = [];
  for (let start = from; start < now + slotMs; start += slotMs) {
    const show = SHOWS[(index + Math.floor(start / slotMs)) % SHOWS.length];
    out.push({
      title: b64(show),
      description: b64(`${show} (archive) on channel ${index + 1}.`),
      start: new Date(start).toISOString().slice(0, 19).replace('T', ' '),
      end: new Date(start + slotMs).toISOString().slice(0, 19).replace('T', ' '),
      start_timestamp: String(start / 1000),
      stop_timestamp: String((start + slotMs) / 1000),
      has_archive: start + slotMs <= now ? '1' : '0',
    });
  }
  return out;
}

export function mockVodInfo(vodId: string, origin: string): unknown {
  const i = (Number(vodId) - 500000) % 100000;
  return {
    info: {
      movie_image: `${origin}/__fixtures/logo/${i % 50}.svg`,
      plot: `A mock movie number ${i + 1} for testing playback, resume and the detail page.`,
      genre: ['Drama', 'Comedy', 'Action', 'Documentary'][i % 4],
      director: 'Test Director',
      cast: 'Actor One, Actor Two',
      releasedate: `${1980 + (i % 45)}-06-01`,
      duration_secs: 300,
      rating: String((i % 10) + 0.5),
    },
    movie_data: { stream_id: Number(vodId), name: `Movie ${i + 1}`, container_extension: i % 3 ? 'mp4' : 'mkv' },
  };
}

export function mockSeriesInfo(seriesId: string, origin: string): unknown {
  const i = Number(seriesId) - 700000;
  const seasons = 1 + (i % 3);
  const episodes: Record<string, unknown[]> = {};
  // Every 7th series is a long one, for testing lists that need scrolling.
  const perSeason = i % 7 === 6 ? 120 : 6;
  for (let s = 1; s <= seasons; s++) {
    episodes[String(s)] = Array.from({ length: perSeason }, (_, k) => ({
      id: String(800000 + i * 1000 + s * 200 + k + 1),
      episode_num: k + 1,
      title: `S${s} E${k + 1} · Episode title`,
      container_extension: 'mp4',
      info: { duration_secs: 300, plot: `Episode ${k + 1} of season ${s}.`, movie_image: `${origin}/__fixtures/logo/${(i + k) % 50}.svg` },
      season: s,
    }));
  }
  return {
    seasons: Array.from({ length: seasons }, (_, k) => ({ season_number: k + 1, name: `Season ${k + 1}` })),
    info: {
      name: `Series ${i + 1}`,
      cover: `${origin}/__fixtures/logo/${i % 50}.svg`,
      plot: `A mock series with ${seasons} season(s).`,
      genre: 'Drama',
      cast: 'Actor One',
      releaseDate: '2020-01-01',
      rating: '7.5',
    },
    episodes,
  };
}
