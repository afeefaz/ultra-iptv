// Finds the groups in a provider's category names (`AR| News`, `UK - Sports`, `[FR] Films`), so a
// long list can be handled a group at a time. Nothing about languages or countries is built in: the
// names decide, and a provider without a pattern just gets no groups.

const MAX_LABEL = 14;
/** To show that a provider really names categories this way. */
const MIN_TO_PROVE_PATTERN = 3;
/** Once it does, a small group counts too: someone may want exactly that language. */
const MIN_IN_GROUP = 2;
const MIN_GROUPS = 2;
/** Below this share of the list, a "pattern" is more likely a coincidence. */
const MIN_COVERAGE = 0.4;

const DECORATION = /^[\s#*=~_.\-–—|•·»>▎▌►▶★☆]+/;
const BRACKETED = /^[[(]([^\])]+)[\])]/;
// A hyphen or slash only counts with spaces around it: not `Al-Noor` or `24/7`.
const SEPARATOR = /\s*[|:•·»]\s*|\s+[-–—/]\s+/;

export interface CategoryGroup<T> {
  /** Stable across spelling of case and spaces. */
  key: string;
  label: string;
  items: T[];
}

export interface GroupedCategories<T> {
  groups: Array<CategoryGroup<T>>;
  other: T[];
}

const toKey = (label: string) => label.replace(/\s+/g, ' ').trim().toUpperCase();

/** The text a name starts with before a separator or in brackets. Null if it has none. */
export function groupLabel(name: string): string | null {
  const trimmed = name.replace(DECORATION, '');
  const bracketed = BRACKETED.exec(trimmed);
  let label: string | undefined;
  if (bracketed && trimmed.length > bracketed[0].length) {
    label = bracketed[1];
  } else {
    const separator = SEPARATOR.exec(trimmed);
    if (separator && separator.index > 0 && separator.index + separator[0].length < trimmed.length) label = trimmed.slice(0, separator.index);
  }
  const clean = label?.replace(/\s+/g, ' ').trim();
  // Needs to be a word of some kind, and short: a long start is just a long name.
  if (!clean || clean.length > MAX_LABEL || /^[\d\s]+$/.test(clean)) return null;
  return clean;
}

export const groupKey = (name: string): string | null => {
  const label = groupLabel(name);
  return label ? toKey(label) : null;
};

/** Auto mode needs the pattern to explain most of the list, so a coincidence doesn't regroup it. */
export const AUTO_COVERAGE = 0.7;

/** Null when the names don't follow a pattern. Groups stay in the order they first appear. */
export function detectGroups<T extends { name: string }>(items: T[], minCoverage = MIN_COVERAGE): GroupedCategories<T> | null {
  const byKey = new Map<string, CategoryGroup<T>>();
  for (const item of items) {
    const label = groupLabel(item.name);
    if (!label) continue;
    const key = toKey(label);
    const group = byKey.get(key);
    if (group) group.items.push(item);
    else byKey.set(key, { key, label, items: [item] });
  }
  const groups: Array<CategoryGroup<T>> = [];
  let proven = 0;
  let provenItems = 0;
  byKey.forEach((group) => {
    if (group.items.length >= MIN_IN_GROUP) groups.push(group);
    if (group.items.length >= MIN_TO_PROVE_PATTERN) {
      proven++;
      provenItems += group.items.length;
    }
  });
  if (proven < MIN_GROUPS || provenItems < items.length * minCoverage) return null;
  const inGroup = new Set<T>();
  for (const group of groups) for (const item of group.items) inGroup.add(item);
  return { groups, other: items.filter((item) => !inGroup.has(item)) };
}

/** Whole groups hidden by the user, so a category the provider adds to one stays hidden. */
export interface HiddenRule {
  labels: string[];
  /** Categories shown by hand inside a hidden group or filter. */
  shown: string[];
  /** Words (see `detectTags`) whose categories are hidden. Missing in a rule saved before filters. */
  tags?: string[];
}

export const EMPTY_RULE: HiddenRule = { labels: [], shown: [], tags: [] };

/** Adds what the rule hides to the hidden ids. */
export function applyHiddenRule(categories: Array<{ id: string; name: string }>, ids: string[], rule: HiddenRule): string[] {
  const tags = rule.tags ?? [];
  if (!rule.labels.length && !tags.length) return ids;
  const out = ids.slice();
  const known = new Set(ids);
  for (const category of categories) {
    if (rule.shown.indexOf(category.id) >= 0 || known.has(category.id)) continue;
    const key = groupKey(category.name);
    const byGroup = !!key && rule.labels.indexOf(key) >= 0;
    const byTag = tags.length > 0 && tagWords(category.name).some((w) => tags.indexOf(w) >= 0);
    if (byGroup || byTag) out.push(category.id);
  }
  return out;
}

// ---- Filters: words that many category names share, whatever their group ----

/** A word is a filter once this many categories have it, and only if it isn't most of the list. */
const MIN_TAG_CATEGORIES = 4;
const MAX_TAG_SHARE = 0.5;
const MAX_TAGS = 12;
const MIN_TAG_LENGTH = 3;

/** Quality and format marks, and words too general to say anything about a category. */
const NOT_A_TAG = new Set(
  ('4K 8K HD FHD UHD RAW VIP SD HEVC 60FPS 3840P 1080P DOLBY VISION AUDIO ATMOS HDR H265 ' +
    'MOVIES MOVIE FILMS FILM SERIES SERIE THE AND FOR NEW ALL TOP BEST WITH FROM CHANNELS CHANNEL').split(' '),
);

const NON_LATIN = /[\u0590-\u06ff\u0700-\u08ff\u0900-\u0e7f\u0370-\u03ff\u0400-\u04ff\u3040-\u30ff\u4e00-\u9fff]+/g;
const COMBINING = /[\u0300-\u036f]/g;

/**
 * The words of a name that could be filters: capitalised alike, without accents, small print,
 * the part in another script, the leading group label or the quality marks.
 */
export function tagWords(name: string): string[] {
  let text = name
    .normalize('NFKD')
    .replace(COMBINING, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(NON_LATIN, ' ')
    .toUpperCase();
  text = text.replace(/^\W*[A-Z]{2,4}\s*[|:-]\s*/, '');
  const out: string[] = [];
  for (const raw of text.split(/[^A-Z0-9+&]+/)) {
    if (raw.length >= MIN_TAG_LENGTH && !NOT_A_TAG.has(raw) && !/^\d+$/.test(raw) && out.indexOf(raw) < 0) out.push(raw);
  }
  return out;
}

export interface CategoryTag {
  /** The word, as `tagWords` makes it. */
  key: string;
  ids: string[];
}

/** The words shared by enough categories to filter by, the most common first. Empty if there are none. */
export function detectTags(categories: Array<{ id: string; name: string }>): CategoryTag[] {
  const byWord = new Map<string, string[]>();
  for (const category of categories) {
    for (const word of tagWords(category.name)) {
      const ids = byWord.get(word);
      if (ids) ids.push(category.id);
      else byWord.set(word, [category.id]);
    }
  }
  const tags: CategoryTag[] = [];
  byWord.forEach((ids, key) => {
    if (ids.length >= MIN_TAG_CATEGORIES && ids.length <= categories.length * MAX_TAG_SHARE) tags.push({ key, ids });
  });
  return tags.sort((a, b) => b.ids.length - a.ids.length).slice(0, MAX_TAGS);
}
