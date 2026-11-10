// Checks the legacy bundle (spec §3.1) for things Chrome 53 (webOS 4) / 56 (Tizen 4) can't run.
// Usage: node scripts/check-legacy.mjs apps/web/dist-legacy
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: check-legacy.mjs <dist-legacy dir>');
  process.exit(2);
}

const files = [];
(function walk(d) {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(dir);

const problems = [];

// 1. JavaScript syntax: ES2016 at most. Chrome 53 has ES2016 (incl. ** from Chrome 52) but no
//    async/await, object spread or optional chaining.
const js = files.filter((f) => f.endsWith('.js'));
if (js.length === 0) problems.push('no .js files found');
try {
  execFileSync(join('node_modules', '.bin', 'es-check'), ['es2016', ...js], { stdio: 'pipe' });
} catch (e) {
  problems.push(`es-check es2016 failed:\n${String(e.stdout || '')}${String(e.stderr || '')}`);
}

// 2. CSS features missing in Chrome 53.
const CSS_RULES = [
  [/display\s*:\s*(inline-)?grid/i, 'CSS Grid (Chrome 57+)'],
  [/(^|[{;\s])(row-|column-)?gap\s*:/i, 'gap (flex gap is Chrome 84+)'],
  [/\b(margin|padding|border)-(inline|block)(-start|-end)?\s*:/i, 'logical properties (Chrome 69–87+)'],
  [/\binset(-inline|-block)?\s*:/i, 'inset (Chrome 87+)'],
  [/:(is|where|has)\(/i, ':is/:where/:has (Chrome 88+)'],
  [/aspect-ratio\s*:/i, 'aspect-ratio (Chrome 88+)'],
  [/(^|[^-])\bclamp\(|\bmin\(|\bmax\(/i, 'min()/max()/clamp() (Chrome 79+)'],
  [/#([0-9a-f]{4}|[0-9a-f]{8})\b/i, '4/8-digit hex colours (Chrome 62+)'],
];

// The legacy plugin inlines CSS into the JS bundle; pull out the string literal holding the stylesheet.
function embeddedCss(js) {
  const sheets = [];
  let from = 0;
  for (;;) {
    const at = js.indexOf(':root{', from);
    if (at < 0) return sheets;
    let start = at;
    while (start > 0 && !'"\'`'.includes(js[start - 1])) start--;
    const quote = js[start - 1];
    let end = at;
    while (end < js.length && !(js[end] === quote && js[end - 1] !== '\\')) end++;
    sheets.push(js.slice(start, end));
    from = end + 1;
  }
}

const stylesheets = files.filter((p) => p.endsWith('.css')).map((f) => [f, readFileSync(f, 'utf8')]);
for (const f of js) for (const css of embeddedCss(readFileSync(f, 'utf8'))) stylesheets.push([`${f} (inlined CSS)`, css]);
if (stylesheets.length === 0) problems.push('no CSS found (neither .css files nor CSS inlined in JS)');
for (const [name, css] of stylesheets) {
  for (const [re, what] of CSS_RULES) if (re.test(css)) problems.push(`${name}: uses ${what}`);
}

// 3. Workers get no polyfills: flag built-ins Chrome 53 lacks.
const WORKER_BUILTINS = [
  [/\.finally\(/, 'Promise#finally (Chrome 63)'],
  [/Object\.(entries|values)\(/, 'Object.entries/values (Chrome 54)'],
  [/Object\.fromEntries\(/, 'Object.fromEntries (Chrome 73)'],
  [/\.(padStart|padEnd)\(/, 'String#padStart/padEnd (Chrome 57)'],
  [/\.(flat|flatMap)\(/, 'Array#flat/flatMap (Chrome 69)'],
  [/\.replaceAll\(/, 'String#replaceAll (Chrome 85)'],
  [/\bstructuredClone\(/, 'structuredClone (Chrome 98)'],
];
// The catalogue worker and the section worker it starts: neither gets polyfills.
for (const f of js.filter((p) => /(worker|section)[^/]*\.js$/.test(p))) {
  const code = readFileSync(f, 'utf8');
  for (const [re, what] of WORKER_BUILTINS) if (re.test(code)) problems.push(`${f}: worker uses ${what} (no polyfills in workers)`);
}

// 4. HTML must not rely on ES modules.
for (const f of files.filter((p) => p.endsWith('.html'))) {
  const html = readFileSync(f, 'utf8');
  if (/<script[^>]+type=["']module["']/i.test(html)) problems.push(`${f}: has <script type="module">`);
}

if (problems.length) {
  console.error('Legacy bundle check FAILED:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(
  `Legacy bundle check passed: ${js.length} JS files at ES2016 syntax; ${stylesheets.length} stylesheet(s) within Chrome 53 CSS rules.`,
);
