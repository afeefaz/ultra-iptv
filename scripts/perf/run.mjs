#!/usr/bin/env node
// Drives the installed app over a debugging connection and records how it performs, using whatever
// playlist is already active on the device. Results go to perf-results/ (gitignored): they hold
// numbers only, but they describe one person's device and account, so they stay local.
//
//   node scripts/perf/run.mjs --adb <serial> --label phone
//   node scripts/perf/run.mjs --tizen <tv-ip> --label samsung-tv
//   options: --cold <n> cold starts (default 3)   --skip-refresh   --skip-playback   --skip-speed
//            --refresh-only  re-measures just the catalogue refresh, added to the last full run
//
// Real channels are played, so run one device at a time: providers limit connections.
// Android needs a debug build (release builds turn WebView debugging off).
/* global fetch, setTimeout, WebSocket */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const has = (name) => args.includes(name);
const serial = opt('--adb');
const tvIp = opt('--tizen');
const label = opt('--label', serial ?? tvIp ?? 'device');
const coldRuns = Number(opt('--cold', '3'));
const PACKAGE = 'com.ultraiptv.player';
const TIZEN_APP = 'ULTRAIPTV1.UltraIPTV';
const PORT = 9344;
const SDB = join(homedir(), 'tizen-studio/tools/sdb');
if (!serial && !tvIp) throw new Error('Pass --adb <serial> or --tizen <ip>');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const COMMAND_TIMEOUT_MS = 30_000;
const adb = (...a) => execFileSync('adb', ['-s', serial, ...a], { encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS }).trim();
const sdb = (...a) => execFileSync(SDB, ['-s', `${tvIp}:26101`, ...a], { encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS }).trim();
const say = (...a) => console.log(`[${label}]`, ...a);

// ---- connection -----------------------------------------------------------------------------
let ws;
let nextId = 0;
const waiting = new Map();

async function attach() {
  let list;
  for (let i = 0; i < 60; i++) {
    try {
      list = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter((p) => p.type === 'page');
      if (list.length) break;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  if (!list?.length) throw new Error('No debuggable page: is this a debug build, and is the app open?');
  ws?.close();
  ws = new WebSocket(list[0].webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener('open', r);
    ws.addEventListener('error', j);
  });
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiting.has(d.id)) {
      waiting.get(d.id)(d.result ?? d.error);
      waiting.delete(d.id);
    }
  });
}

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++nextId;
    waiting.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

async function js(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] ?? 'script failed');
  return r.result?.value;
}

/** Restarts the app from scratch and reconnects. Returns the OS's launch time where it reports one. */
async function coldStart() {
  ws?.close();
  ws = null;
  if (serial) {
    adb('shell', 'am', 'force-stop', PACKAGE);
    await sleep(1500);
    const out = adb('shell', 'am', 'start', '-W', '-n', `${PACKAGE}/.MainActivity`);
    const total = /TotalTime: (\d+)/.exec(out);
    await sleep(500);
    const pid = adb('shell', 'pidof', PACKAGE).split(/\s+/)[0];
    adb('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`);
    await attach();
    return total ? Number(total[1]) : undefined;
  }
  // A launch is ignored while the app is running, so close it first.
  sdb('shell', '0', 'was_kill', TIZEN_APP.split('.')[0]);
  await sleep(2500);
  const out = sdb('shell', '0', 'debug', TIZEN_APP);
  const port = /port:\s*(\d+)/i.exec(out);
  if (!port) throw new Error(`Could not start the app in debug mode: ${out.slice(0, 120)}`);
  try {
    sdb('forward', '--remove', `tcp:${PORT}`);
  } catch {
    // nothing forwarded yet
  }
  sdb('forward', `tcp:${PORT}`, `tcp:${port[1]}`);
  await attach();
  return undefined;
}

// ---- driving the app --------------------------------------------------------------------------
const KEYS = { up: ['ArrowUp', 38], down: ['ArrowDown', 40], left: ['ArrowLeft', 37], right: ['ArrowRight', 39], ok: ['Enter', 13], back: ['Escape', 27] };

async function key(name, gapMs = 150) {
  const [k, code] = KEYS[name];
  if (name === 'back') await js('window.__perfT = performance.now()');
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: code });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code });
  await sleep(gapMs);
}

const keys = async (name, times, gapMs) => {
  for (let i = 0; i < times; i++) await key(name, gapMs);
};
// Actions start the clock inside the page, so `until` measures from the action, not from the reply.
const tab = (index) => js(`window.__perfT = performance.now(); document.querySelectorAll('.btn.tab')[${index}].click()`);
const click = (selector, index = 0) => js(`(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!el) return false; window.__perfT = performance.now(); el.click(); return true; })()`);

/** Time from the last action until an element exists, measured inside the page. */
const until = (selector, timeoutMs = 30_000) =>
  js(`new Promise((done) => {
    const start = window.__perfT || performance.now();
    const tick = () => {
      if (document.querySelector(${JSON.stringify(selector)})) return done(Math.round(performance.now() - start));
      if (performance.now() - start > ${timeoutMs}) return done(null);
      requestAnimationFrame(tick);
    };
    tick();
  })`);

async function typeInto(fieldIndex, text) {
  await click('.field-box', fieldIndex);
  await sleep(500);
  const native = await js(`!!document.querySelector('.field-box input')`);
  for (let i = 1; i <= text.length; i++) {
    if (native) {
      await js(`(() => { const el = document.querySelectorAll('.field-box input')[${fieldIndex}]; el.value = ${JSON.stringify(text.slice(0, i))}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    } else {
      const c = text[i - 1];
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: c, text: c, windowsVirtualKeyCode: c.toUpperCase().charCodeAt(0) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: c, windowsVirtualKeyCode: c.toUpperCase().charCodeAt(0) });
    }
    await sleep(250);
  }
  if (!native) await key('back', 400);
}

async function clearField(fieldIndex) {
  const native = await js(`!!document.querySelector('.field-box input')`);
  if (native) {
    await js(`(() => { const el = document.querySelectorAll('.field-box input')[${fieldIndex}]; el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); el.blur(); })()`);
  } else {
    await click('.field-box', fieldIndex);
    await sleep(400);
    await js(`[...document.querySelectorAll('.osk-key')].slice(-2)[0].click()`);
    await key('back', 400);
  }
}

// ---- recording ---------------------------------------------------------------------------------
const results = { label, startedAt: new Date().toISOString(), device: null, cold: [], steps: {}, usage: null };

const slim = (s) => (s ? { stats: s.stats, counters: s.counters, gauges: s.gauges } : null);

/** Runs one phase from clean counters, and keeps what it measured. Errors are recorded, not fatal. */
async function step(name, fn) {
  say(name);
  try {
    await js('__ultraPerf.reset()');
    await js('__ultraPerf.startFrames()');
    const value = await fn();
    await js('__ultraPerf.stopFrames()');
    const report = await js('__ultraPerf.report()');
    results.steps[name] = { value, page: slim(report.page), worker: slim(report.worker), system: report.system };
  } catch (e) {
    results.steps[name] = { error: e.message };
    say(`  failed: ${e.message}`);
    await js('__ultraPerf.stopFrames()').catch(() => undefined);
  }
}

/** Waits for a stat to be recorded more times (a first frame arriving, say). */
async function waitForStat(name, before, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const count = await js(`__ultraPerf.report().then((r) => (r.page.stats[${JSON.stringify(name)}] || { count: 0 }).count)`);
    if (count > before) return true;
    await sleep(500);
  }
  return false;
}

const statCount = (name) => js(`__ultraPerf.report().then((r) => (r.page.stats[${JSON.stringify(name)}] || { count: 0 }).count)`);

async function openSettings() {
  await step('settings.open', async () => {
    await click('.topbar-end .icon-button');
    return until('.settings-layout');
  });
}

async function refreshStep() {
  await step('catalogue.refresh', async () => {
    const opened = await click('#settings-playlists .btn');
    if (!opened) throw new Error('Manage playlists not found');
    await until('.screen.playlists');
    await sleep(800);
    await js(`[...document.querySelectorAll('.playlists .btn')].find((b) => /refresh|تحديث/i.test(b.textContent)).click()`);
    await sleep(1500);
    const start = Date.now();
    while (Date.now() - start < 300_000 && (await js(`!!document.querySelector('.loading-line')`))) await sleep(1000);
    return Math.round((Date.now() - start) / 1000);
  });
}

async function finish() {
  results.usage = (await js('__ultraPerf.report()')).usage;
  await tab(0);
  ws.close();
  if (serial) adb('forward', '--remove', `tcp:${PORT}`);
  else {
    sdb('forward', '--remove', `tcp:${PORT}`);
    sdb('shell', '0', 'was_kill', TIZEN_APP.split('.')[0]);
    sdb('shell', '0', 'debug', TIZEN_APP); // leaves the app open, on Home
  }

  mkdirSync(join(root, 'perf-results'), { recursive: true });
  if (has('--refresh-only')) {
    // Adds to the newest full run of this device instead of replacing it.
    const previous = readdirSync(join(root, 'perf-results')).filter((n) => n.startsWith(`${label}-`)).sort().pop();
    if (previous) {
      const earlier = JSON.parse(readFileSync(join(root, 'perf-results', previous), 'utf8'));
      results.cold = earlier.cold;
      results.device = earlier.device;
      results.steps = { ...earlier.steps, ...results.steps };
    }
  }
  const file = join(root, 'perf-results', `${label}-${results.startedAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(results, null, 1));
  say(`saved ${file}`);
}

// ---- the run -----------------------------------------------------------------------------------
if (has('--refresh-only')) {
  await coldStart();
  await until('.topbar');
  await sleep(6000);
  await openSettings();
  await refreshStep();
  await finish();
  process.exit(0);
}

for (let i = 0; i < coldRuns; i++) {
  const osLaunchMs = await coldStart();
  await until('.topbar');
  await sleep(6000);
  const report = await js('__ultraPerf.report()');
  results.device = report.device;
  results.cold.push({ osLaunchMs, marks: report.page.marks, stats: report.page.stats, workerStats: report.worker?.stats, gauges: report.page.gauges, system: report.system });
  say(`cold start ${i + 1}: first frame ${report.page.marks['startup.firstFrame']} ms`);
}

await step('idle.home.10s', () => sleep(10_000));

await step('live.firstOpen', async () => {
  await tab(1);
  return until('.channel-row');
});
await sleep(1500);

await step('live.openCategory', async () => {
  // Arrow to a real category and open it, like the remote does.
  await click('.pane-categories .list-item', 4);
  await sleep(1500);
  return js(`document.querySelectorAll('.channel-row').length`);
});

await step('live.scroll.40keys', async () => {
  await key('right', 300);
  await keys('down', 40, 120);
});
await keys('up', 40, 40);

await step('live.search', async () => {
  // Across every channel: the worst case.
  await click('.pane-categories .list-item', 2);
  await sleep(800);
  await typeInto(1, 'news');
  await sleep(800);
  const shown = await js(`document.querySelectorAll('.channel-row').length`);
  await clearField(1);
  return shown;
});
await sleep(800);

if (!has('--skip-playback')) {
  await step('live.zap.5channels', async () => {
    await click('.pane-categories .list-item', 2);
    await sleep(800);
    const started = [];
    for (let i = 0; i < 5; i++) {
      const before = await statCount('player.zap');
      await click('.channel-row', i);
      started.push(await waitForStat('player.zap', before, 20_000));
      await sleep(4000);
    }
    return { started: started.filter(Boolean).length, tried: started.length };
  });

  await step('live.fullscreen', async () => {
    await click('.channel-row.is-focused');
    await until('.player-screen');
    await sleep(6000);
  });

  await step('live.backFromPlayer', async () => {
    await key('back', 0);
    const ms = await until('.channel-row');
    await sleep(3000);
    return ms;
  });
}

await step('movies.firstOpen', async () => {
  await tab(2);
  return until('.vgrid-cell');
});
await sleep(1500);

await step('movies.sortByName', async () => {
  await click('.sort-chip');
  await sleep(500);
  await click('.dialog .btn', 1);
  await sleep(1500);
});
await step('movies.sortBack', async () => {
  await click('.sort-chip');
  await sleep(500);
  await click('.dialog .btn', 0);
  await sleep(1500);
});

await step('movies.search', async () => {
  await click('.pane-categories .list-item', 2);
  await sleep(800);
  await typeInto(1, 'the');
  await sleep(800);
  await clearField(1);
});
await sleep(800);

await step('movies.scroll.30keys', async () => {
  await click('.pane-categories .list-item', 2);
  await sleep(800);
  await key('right', 300);
  await keys('down', 30, 150);
});
await keys('up', 30, 40);

await step('movies.openPage', async () => {
  await click('.vgrid-cell', 0);
  const ms = await until('.screen.detail h1');
  await sleep(2500);
  return ms;
});

if (!has('--skip-playback')) {
  await step('movies.play', async () => {
    const before = await statCount('player.startMedia');
    const play = await click('.detail-actions .btn-primary');
    const started = play && (await waitForStat('player.startMedia', before, 25_000));
    await sleep(6000);
    return { started };
  });
  await step('movies.backFromPlayer', async () => {
    await key('back', 0);
    return until('.screen.detail h1');
  });
}

await step('movies.backToGrid', async () => {
  await key('back', 0);
  return until('.vgrid-cell');
});

await step('series.firstOpen', async () => {
  await tab(3);
  return until('.vgrid-cell');
});
await sleep(1500);
await step('series.openPage', async () => {
  await click('.vgrid-cell', 0);
  const ms = await until('.screen.detail h1');
  await sleep(2500);
  return ms;
});
await key('back', 500);

await step('home.reopen', async () => {
  await tab(0);
  await sleep(1500);
});

await openSettings();

if (!has('--skip-speed')) {
  await step('speedTest', async () => {
    await click('.speed-test .btn');
    await sleep(1000);
    for (let i = 0; i < 60 && (await js(`!!document.querySelector('.speed-running')`)); i++) await sleep(1000);
    return js(`[...document.querySelectorAll('.speed-figure')].map((f) => f.textContent.trim()).join(' | ') || 'no result'`);
  });
}

if (!has('--skip-refresh')) await refreshStep();

await finish();
