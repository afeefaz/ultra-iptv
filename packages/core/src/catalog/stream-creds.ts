// M3U stream URLs from IPTV providers usually embed the account (…/live/<u>/<p>/123.ts or
// ?username=&password=). Stored rows get {u}/{p} placeholders instead, and the pair itself goes
// into the encrypted secret (spec §4.4: credentials encrypted at rest).

export interface CredPair {
  u: string;
  p: string;
}

const PATH_PREFIXES = ['live', 'movie', 'series', 'timeshift'];
const SHORT_ID = /^\d+(\.[a-z0-9]+)?$/i;

interface Located {
  pair: CredPair;
  /** Rebuilds the URL with placeholders. */
  template: () => string;
}

function locate(url: string): Located | null {
  const q = url.indexOf('?');
  const base = q < 0 ? url : url.slice(0, q);
  const query = q < 0 ? '' : url.slice(q + 1);
  const schemeEnd = base.indexOf('://');
  const pathStart = schemeEnd < 0 ? -1 : base.indexOf('/', schemeEnd + 3);
  if (pathStart >= 0) {
    const origin = base.slice(0, pathStart);
    const parts = base.slice(pathStart + 1).split('/');
    let at = -1;
    // /<prefix>/<u>/<p>/<id…>
    for (let i = 0; i <= parts.length - 4; i++) {
      if (PATH_PREFIXES.indexOf(parts[i].toLowerCase()) >= 0) {
        at = i + 1;
        break;
      }
    }
    if (at < 0 && parts.length >= 3 && SHORT_ID.test(parts[parts.length - 1])) at = parts.length - 3;
    if (at >= 0 && parts[at] && parts[at + 1]) {
      const pair = { u: parts[at], p: parts[at + 1] };
      return {
        pair,
        template: () => {
          const copy = parts.slice();
          copy[at] = '{u}';
          copy[at + 1] = '{p}';
          return origin + '/' + copy.join('/') + (q < 0 ? '' : url.slice(q));
        },
      };
    }
  }
  if (query) {
    const params = query.split('&');
    let ui = -1;
    let pi = -1;
    for (let i = 0; i < params.length; i++) {
      const name = params[i].split('=')[0].toLowerCase();
      if (name === 'username') ui = i;
      else if (name === 'password') pi = i;
    }
    if (ui >= 0 && pi >= 0) {
      const value = (i: number) => params[i].slice(params[i].indexOf('=') + 1);
      return {
        pair: { u: value(ui), p: value(pi) },
        template: () => {
          const copy = params.slice();
          copy[ui] = copy[ui].split('=')[0] + '={u}';
          copy[pi] = copy[pi].split('=')[0] + '={p}';
          return base + '?' + copy.join('&');
        },
      };
    }
  }
  return null;
}

/** The pair used by most stream URLs, or null if none embed credentials. */
export function dominantPair(urls: string[]): CredPair | null {
  const counts = new Map<string, { pair: CredPair; n: number }>();
  for (const url of urls) {
    const found = locate(url);
    if (!found) continue;
    const id = found.pair.u + '\n' + found.pair.p;
    const entry = counts.get(id);
    if (entry) entry.n++;
    else counts.set(id, { pair: found.pair, n: 1 });
  }
  let best: { pair: CredPair; n: number } | null = null;
  counts.forEach((c) => {
    if (!best || c.n > best.n) best = c;
  });
  return best ? (best as { pair: CredPair }).pair : null;
}

/** Replaces the pair with {u}/{p} when this URL carries exactly that pair. */
export function templateUrl(url: string, pair: CredPair): string {
  const found = locate(url);
  return found && found.pair.u === pair.u && found.pair.p === pair.p ? found.template() : url;
}

export function fillUrl(template: string, pair: CredPair | null): string {
  if (!pair) return template;
  return template.replace(/\{u\}/g, pair.u).replace(/\{p\}/g, pair.p);
}
