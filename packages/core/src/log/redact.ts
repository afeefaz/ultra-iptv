// The only way a URL, header set, error or free text may reach a log entry (spec §10).
// Regexes here must stay Chrome 53-compatible: no lookbehind, named groups or the `s` flag.

export const MASK = '***';

const XTREAM_PATH_PREFIXES = ['live', 'movie', 'series', 'timeshift', 'playlist'];
const SENSITIVE_PARAM =
  /^(user|username|pass|password|pwd|token|access_token|auth|authorization|key|api_?key|secret|sig|signature|mac|sn|serial)$/i;
const SENSITIVE_FIELD =
  /^(user|username|pass|password|pwd|token|secret|credentials?|authorization|proxy-authorization|cookie|set-cookie|api_?key)$/i;
const SENSITIVE_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie)$/i;
const URL_IN_TEXT = /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>`]+/gi;
const TRAILING_PUNCT = /[.,;:!?)\]}]+$/;
const SHORT_XTREAM_ID = /^\d+(\.[a-z0-9]+)?$/i;
/** Label format produced by the host hasher: a valid hostname, so redacted URLs still parse. */
const HASHED_HOST = /^host-[0-9a-f]{8}$/;
const MIN_SECRET_LENGTH = 3;
const MAX_DEPTH = 6;
const MAX_ARRAY = 50;

export interface RedactorOptions {
  hashHost(host: string): string;
  /** Hosts left readable, e.g. the app's own origin (stack traces). */
  keepHosts?: Iterable<string>;
}

export class Redactor {
  private readonly secrets = new Set<string>();
  private readonly hosts = new Set<string>();
  private readonly keepHosts: Set<string>;
  private secretPattern: RegExp | null = null;
  private hostPattern: RegExp | null = null;

  constructor(private readonly opts: RedactorOptions) {
    this.keepHosts = new Set(Array.from(opts.keepHosts ?? [], (h) => h.toLowerCase()));
  }

  /** Register a credential (playlist username/password) to scrub wherever it appears. */
  addSecret(secret: string): void {
    if (!secret || secret.length < MIN_SECRET_LENGTH || this.secrets.has(secret)) return;
    this.secrets.add(secret);
    this.secretPattern = null;
  }

  addKeepHost(host: string): void {
    this.keepHosts.add(host.toLowerCase());
  }

  /** Register a provider host so bare mentions (e.g. DNS errors) get hashed too. */
  addHost(host: string): void {
    const h = host.toLowerCase();
    if (!h || this.keepHosts.has(h) || this.hosts.has(h)) return;
    this.hosts.add(h);
    this.hostPattern = null;
  }

  text(input: string): string {
    let out = input.replace(URL_IN_TEXT, (match) => {
      const trail = TRAILING_PUNCT.exec(match);
      const core = trail ? match.slice(0, -trail[0].length) : match;
      return this.url(core) + (trail ? trail[0] : '');
    });
    out = this.scrubHosts(out);
    return this.scrubSecrets(out);
  }

  url(raw: string): string {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return this.scrubSecrets(this.scrubHosts(this.urlFallback(raw)));
    }
    if (!u.hostname) return this.scrubSecrets(u.protocol === 'data:' ? raw.slice(0, 48) + '…' : raw);
    const userinfo = u.username || u.password ? `${MASK}@` : '';
    const host = this.hostLabel(u.hostname) + (u.port ? `:${u.port}` : '');
    const search = u.search ? '?' + this.params(u.search.slice(1)) : '';
    const hash = u.hash ? '#' + (u.hash.indexOf('=') >= 0 ? this.params(u.hash.slice(1)) : u.hash.slice(1)) : '';
    return this.scrubSecrets(`${u.protocol}//${userinfo}${host}${maskPath(u.pathname)}${search}${hash}`);
  }

  headers(h: Record<string, unknown>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const k of Object.keys(h)) out[k] = SENSITIVE_HEADER.test(k) ? MASK : this.text(String(h[k]));
    return out;
  }

  /** Deep-redacts structured log data. */
  value(v: unknown, depth = 0): unknown {
    if (typeof v === 'string') return this.text(v);
    if (typeof v === 'bigint') return String(v);
    if (typeof v === 'function' || typeof v === 'symbol') return `[${typeof v}]`;
    if (v === null || typeof v !== 'object') return v;
    if (depth >= MAX_DEPTH) return '[depth]';
    if (v instanceof Error) {
      return { name: v.name, message: this.text(v.message), stack: v.stack ? this.text(v.stack) : undefined };
    }
    if (Array.isArray(v)) return v.slice(0, MAX_ARRAY).map((x) => this.value(x, depth + 1));
    if (isHeaders(v)) return this.headers(normalizeHeaders(v));
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) {
      const val = (v as Record<string, unknown>)[k];
      if (SENSITIVE_FIELD.test(k)) out[k] = MASK;
      else if (k.toLowerCase() === 'headers' && val && typeof val === 'object' && !Array.isArray(val)) {
        out[k] = this.headers(normalizeHeaders(val));
      } else out[k] = this.value(val, depth + 1);
    }
    return out;
  }

  private hostLabel(hostname: string): string {
    const h = hostname.toLowerCase();
    // Already-redacted labels pass through, so redacting twice changes nothing.
    return this.keepHosts.has(h) || HASHED_HOST.test(h) ? h : this.opts.hashHost(h);
  }

  private params(qs: string): string {
    return qs
      .split('&')
      .map((pair) => {
        const i = pair.indexOf('=');
        if (i < 0) return pair;
        const key = pair.slice(0, i);
        const value = pair.slice(i + 1);
        if (SENSITIVE_PARAM.test(safeDecode(key))) return `${key}=${MASK}`;
        // A URL nested inside a parameter (e.g. ?url=http%3A%2F%2F…) gets the same treatment.
        const decoded = safeDecode(value);
        if (decoded.indexOf('://') >= 0) return `${key}=${encodeURIComponent(this.text(decoded))}`;
        return pair;
      })
      .join('&');
  }

  /** For strings `new URL()` rejects; same rules, applied by pattern. */
  private urlFallback(raw: string): string {
    const m = /^([a-z][a-z0-9+.-]*:\/\/)([^@/?#]*@)?([^/?#:]*)(:\d+)?([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(raw);
    if (!m) return raw;
    const [, scheme, userinfo, host, port, path, query, frag] = m;
    return (
      scheme +
      (userinfo ? `${MASK}@` : '') +
      (host ? this.hostLabel(host) : '') +
      (port || '') +
      (path ? maskPath(path) : '') +
      (query ? '?' + this.params(query.slice(1)) : '') +
      (frag || '')
    );
  }

  private scrubHosts(text: string): string {
    if (this.hosts.size === 0) return text;
    if (!this.hostPattern) {
      const alternatives = Array.from(this.hosts)
        .sort((a, b) => b.length - a.length)
        .map(escapeRegExp)
        .join('|');
      this.hostPattern = new RegExp(`(^|[^a-z0-9.-])(${alternatives})(?![a-z0-9-])`, 'gi');
    }
    return text.replace(this.hostPattern, (_m, prefix: string, host: string) => prefix + this.opts.hashHost(host));
  }

  private scrubSecrets(text: string): string {
    if (this.secrets.size === 0) return text;
    if (!this.secretPattern) {
      const variants = new Set<string>();
      this.secrets.forEach((s) => {
        variants.add(s);
        variants.add(encodeURIComponent(s));
        variants.add(encodeURIComponent(encodeURIComponent(s)));
      });
      const alternatives = Array.from(variants)
        .sort((a, b) => b.length - a.length)
        .map(escapeRegExp)
        .join('|');
      this.secretPattern = new RegExp(alternatives, 'gi');
    }
    return text.replace(this.secretPattern, MASK);
  }
}

function maskPath(pathname: string): string {
  const parts = pathname.split('/');
  const lead = parts[0] === '' ? parts.shift() : undefined;
  if (parts.length >= 3 && XTREAM_PATH_PREFIXES.indexOf(parts[0].toLowerCase()) >= 0) {
    parts[1] = MASK;
    parts[2] = MASK;
  } else if (parts.length === 3 && SHORT_XTREAM_ID.test(parts[2])) {
    // Xtream also serves live streams as /<user>/<pass>/<id>
    parts[0] = MASK;
    parts[1] = MASK;
  }
  return (lead === '' ? '/' : '') + parts.join('/');
}

function isHeaders(val: object): val is Headers {
  return typeof Headers !== 'undefined' && val instanceof Headers;
}

function normalizeHeaders(val: object): Record<string, unknown> {
  if (isHeaders(val)) {
    const plain: Record<string, string> = {};
    val.forEach((value, key) => (plain[key] = value));
    return plain;
  }
  return val as Record<string, unknown>;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
