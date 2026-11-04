#!/usr/bin/env node
// Compares the newest result per device in perf-results/ and prints markdown tables.
//   node scripts/perf/report.mjs
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../../perf-results');
if (!existsSync(dir)) throw new Error('No results yet: run scripts/perf/run.mjs first');
const newest = new Map();
for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
  const r = JSON.parse(readFileSync(join(dir, name), 'utf8'));
  newest.set(r.label, r);
}
const runs = [...newest.values()];
const median = (values) => {
  const v = values.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};
const fmt = (n, unit = '') => (n === null || n === undefined ? '–' : `${n >= 100 ? Math.round(n).toLocaleString('en-US') : Math.round(n * 10) / 10}${unit}`);
const table = (title, rows) => {
  console.log(`\n### ${title}\n`);
  console.log(`| Metric | ${runs.map((r) => r.label).join(' | ')} |`);
  console.log(`|---|${runs.map(() => '---').join('|')}|`);
  for (const [name, get] of rows) console.log(`| ${name} | ${runs.map((r) => { try { return get(r) ?? '–'; } catch { return '–'; } }).join(' | ')} |`);
};
const mark = (name) => (r) => fmt(median(r.cold.map((c) => c.marks[name])), ' ms');
const coldStat = (name, field = 'p50Ms') => (r) => fmt(median(r.cold.map((c) => (c.stats?.[name] ?? c.workerStats?.[name])?.[field])), ' ms');
const value = (step) => (r) => {
  const v = r.steps[step]?.value;
  return typeof v === 'number' ? fmt(v, ' ms') : r.steps[step]?.error ? 'failed' : '–';
};
const stat = (step, name, field = 'p50Ms', where = 'page') => (r) => fmt(r.steps[step]?.[where]?.stats?.[name]?.[field], ' ms');
const blocked = (step) => (r) => {
  const s = r.steps[step]?.page?.stats?.['main.longTask'];
  return s ? `${fmt(s.totalMs, ' ms')} (${s.count})` : '0';
};
const counter = (step, name) => (r) => fmt(r.steps[step]?.page?.counters?.[name] ?? 0);
const MB = 1024 * 1024;
const gaugeMb = (step, name) => (r) => {
  const v = r.steps[step]?.page?.gauges?.[name];
  return v === undefined ? '–' : `${Math.round(v / MB)} MB`;
};

table('Devices', [
  ['Platform', (r) => r.device?.platform],
  ['Model', (r) => r.device?.model],
  ['OS', (r) => r.device?.osVersion],
  ['Web engine', (r) => r.device?.engine],
  ['Screen (CSS px)', (r) => (r.device ? `${r.device.screen.width}×${r.device.screen.height}` : '–')],
  ['Device RAM', (r) => (r.cold[0]?.system?.ramTotal ? `${(r.cold[0].system.ramTotal / 1024 ** 3).toFixed(1)} GB` : '–')],
]);
table('Cold start (median)', [
  ['OS launch to first activity draw', (r) => fmt(median(r.cold.map((c) => c.osLaunchMs)), ' ms')],
  ['Scripts ran', mark('startup.scriptRan')],
  ['Platform ready', mark('startup.platformReady')],
  ['App mounted', mark('startup.appMounted')],
  ['First frame', mark('startup.firstFrame')],
  ['First contentful paint', mark('nav.first-contentful-paint')],
  ['Playlists read', mark('startup.playlistsRead')],
  ['Worker ready', mark('startup.workerReady')],
  ['Home data ready', mark('startup.homeData')],
  ['Home: read all channels', coldStat('db.listItems.live')],
  ['App memory after start', (r) => fmt(median(r.cold.map((c) => (c.system?.appUsed ?? 0) / MB)), ' MB')],
]);
table('Screens (ms until content shows)', [
  ['Live, first open', value('live.firstOpen')],
  ['Live, back from player', value('live.backFromPlayer')],
  ['Movies, first open', value('movies.firstOpen')],
  ['Movies, open a title', value('movies.openPage')],
  ['Movies, back to grid', value('movies.backToGrid')],
  ['Series, first open', value('series.firstOpen')],
  ['Series, open a title', value('series.openPage')],
  ['Settings', value('settings.open')],
]);
table('Main thread blocked (long tasks: total, count)', [
  ['Live, first open', blocked('live.firstOpen')],
  ['Live, open category', blocked('live.openCategory')],
  ['Live, back from player', blocked('live.backFromPlayer')],
  ['Movies, first open', blocked('movies.firstOpen')],
  ['Movies, sort by name', blocked('movies.sortByName')],
  ['Series, first open', blocked('series.firstOpen')],
]);
table('Database and memory cache', [
  ['Load all channels', stat('live.firstOpen', 'library.load.live')],
  ['Load all movies', stat('movies.firstOpen', 'library.load.vod')],
  ['Load all series', stat('series.firstOpen', 'library.load.series')],
  ['Read all channels', stat('live.firstOpen', 'db.listItems.live')],
  ['Read all movies', stat('movies.firstOpen', 'db.listItems.vod')],
  ['Read all series', stat('series.firstOpen', 'db.listItems.series')],
  ['Sort all movies', stat('movies.firstOpen', 'library.sort')],
  ['Sort by name (cold)', stat('movies.sortByName', 'library.sort')],
  ['Sort back (cache hits)', counter('movies.sortBack', 'cache.sorted.hit')],
  ['Build search names, channels', stat('live.firstOpen', 'library.normNames')],
  ['Build search names, movies', stat('movies.firstOpen', 'library.normNames')],
  ['Filter channels, per key', stat('live.search', 'filter.channels')],
  ['Filter movies, per key', stat('movies.search', 'filter.items')],
  ['Library cache hits on return', counter('live.backFromPlayer', 'cache.library.hit.live')],
]);
table('Remote feel', [
  ['Key to frame, Live scroll (p50)', stat('live.scroll.40keys', 'input.toFrame')],
  ['Key to frame, Live scroll (p95)', stat('live.scroll.40keys', 'input.toFrame', 'p95Ms')],
  ['Frame gap, Live scroll (p95)', stat('live.scroll.40keys', 'frame.gap', 'p95Ms')],
  ['Frames dropped, Live scroll', counter('live.scroll.40keys', 'frame.dropped')],
  ['Key to frame, grid scroll (p50)', stat('movies.scroll.30keys', 'input.toFrame')],
  ['Key to frame, grid scroll (p95)', stat('movies.scroll.30keys', 'input.toFrame', 'p95Ms')],
  ['Frames dropped, grid scroll', counter('movies.scroll.30keys', 'frame.dropped')],
  ['Poster load (p50)', stat('movies.scroll.30keys', 'net.image')],
  ['Poster load (p95)', stat('movies.scroll.30keys', 'net.image', 'p95Ms')],
]);
table('Playback', [
  ['Channels started', (r) => { const v = r.steps['live.zap.5channels']?.value; return v ? `${v.started} of ${v.tried}` : '–'; }],
  ['Zap (p50)', stat('live.zap.5channels', 'player.zap')],
  ['Zap (max)', stat('live.zap.5channels', 'player.zap', 'maxMs')],
  ['Movie start', stat('movies.play', 'player.startMedia')],
  ['Rebuffering events', counter('live.zap.5channels', 'player.bufferingEvents')],
  ['Resolutions seen', (r) => Object.keys(r.steps['live.zap.5channels']?.page?.counters ?? {}).filter((k) => k.startsWith('player.resolution.')).map((k) => k.slice(18)).join(', ')],
]);
table('Network and catalogue refresh', [
  ['Speed test', (r) => r.steps.speedTest?.value?.split(' | ')[0]?.replace('Mbps', ' Mbps ')],
  ['Guide requests (Live, open category)', (r) => fmt(r.steps['live.openCategory']?.worker?.stats?.['net.total.get_short_epg']?.count ?? 0)],
  ['Guide requests (Live, search)', (r) => fmt(r.steps['live.search']?.worker?.stats?.['net.total.get_short_epg']?.count ?? 0)],
  ['Lists unchanged on refresh', (r) => fmt(Object.keys(r.steps['catalogue.refresh']?.worker?.counters ?? {}).filter((k) => k.startsWith('refresh.unchanged.')).length)],
  ['Full refresh', stat('catalogue.refresh', 'refresh.total', 'p50Ms', 'worker')],
  ['Live list: first byte', stat('catalogue.refresh', 'net.ttfb.get_live_streams', 'p50Ms', 'worker')],
  ['Live list: download', stat('catalogue.refresh', 'net.total.get_live_streams', 'p50Ms', 'worker')],
  ['Live list: parse', stat('catalogue.refresh', 'net.parse.get_live_streams', 'p50Ms', 'worker')],
  ['Live: build rows', stat('catalogue.refresh', 'refresh.build.live', 'p50Ms', 'worker')],
  ['Live: save', stat('catalogue.refresh', 'refresh.write.live', 'p50Ms', 'worker')],
  ['Movies list: download', stat('catalogue.refresh', 'net.total.get_vod_streams', 'p50Ms', 'worker')],
  ['Movies: save', stat('catalogue.refresh', 'refresh.write.vod', 'p50Ms', 'worker')],
  ['Series list: download', stat('catalogue.refresh', 'net.total.get_series', 'p50Ms', 'worker')],
  ['Series: save', stat('catalogue.refresh', 'refresh.write.series', 'p50Ms', 'worker')],
]);
table('Memory', [
  ['App, on Home after start', (r) => fmt(median(r.cold.map((c) => (c.system?.appUsed ?? 0) / MB)), ' MB')],
  ['App, Live open', gaugeMb('live.firstOpen', 'memory.appBytes')],
  ['App, Movies open', gaugeMb('movies.firstOpen', 'memory.appBytes')],
  ['App, Series open', gaugeMb('series.firstOpen', 'memory.appBytes')],
  ['App, all libraries held', gaugeMb('home.reopen', 'memory.appBytes')],
]);
