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

/** Null when the names don't follow a pattern. Groups stay in the order they first appear. */
export function detectGroups<T extends { name: string }>(items: T[]): GroupedCategories<T> | null {
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
  if (proven < MIN_GROUPS || provenItems < items.length * MIN_COVERAGE) return null;
  const inGroup = new Set<T>();
  for (const group of groups) for (const item of group.items) inGroup.add(item);
  return { groups, other: items.filter((item) => !inGroup.has(item)) };
}

/** Whole groups hidden by the user, so a category the provider adds to one stays hidden. */
export interface HiddenRule {
  labels: string[];
  /** Categories shown by hand inside a hidden group. */
  shown: string[];
}

export const EMPTY_RULE: HiddenRule = { labels: [], shown: [] };

/** Adds what the rule hides to the hidden ids. */
export function applyHiddenRule(categories: Array<{ id: string; name: string }>, ids: string[], rule: HiddenRule): string[] {
  if (!rule.labels.length) return ids;
  const out = ids.slice();
  const known = new Set(ids);
  for (const category of categories) {
    const key = groupKey(category.name);
    if (key && rule.labels.indexOf(key) >= 0 && rule.shown.indexOf(category.id) < 0 && !known.has(category.id)) out.push(category.id);
  }
  return out;
}
