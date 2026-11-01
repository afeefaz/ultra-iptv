// Fails if source files contain invisible or bidi control characters (BOM, zero-width, isolates,
// U+FFFF …). They work at runtime but are unreadable in review; write them as \u escapes instead.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const INVISIBLE = new RegExp('[\\u00a0\\u2000-\\u200f\\u2028-\\u202f\\u2060-\\u206f\\ufeff\\uffff]');
const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', 'packages', 'apps', 'scripts'])
  .toString()
  .trim()
  .split('\n')
  .filter((f) => /\.(ts|tsx|mjs|js|css|html)$/.test(f));

const problems = [];
for (const file of files) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      const m = INVISIBLE.exec(line);
      if (m) problems.push(`${file}:${i + 1}: U+${m[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
    });
}
if (problems.length) {
  console.error('Invisible characters found (use \\u escapes):\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`No invisible characters in ${files.length} source files.`);
