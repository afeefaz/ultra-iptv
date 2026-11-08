import { detectTags, groupKey, listCategories, tagWords, log, UNCATEGORIZED, type CategoryGroup, type CategoryRow, type ContentKind, type HiddenRule } from '@ultra/core';
import { createEffect, createMemo, createSignal, For, on, onMount, Show, type JSX } from 'solid-js';
import { BackButton } from '../components/BackButton';
import { FocusButton } from '../components/FocusButton';
import { Icon } from '../components/Icon';
import { TextField } from '../components/TextField';
import { VirtualList, type VirtualListApi } from '../components/VirtualList';
import { groupsFor, makeMatcher, normalizeText, useCategoryNames, useHiddenCategories } from '../data/categories';
import { ensureUnlocked } from '../data/parental';
import { categoryGrouping, setCategoryGrouping, type CategoryGrouping } from '../data/settings';
import { activePlaylist } from '../data/playlists';
import { FocusZone } from '../focus';
import { formatNumber, t, type MessageKey } from '../i18n';
import { useKeys } from '../keys';
import { goBack } from '../nav';

const TITLES: Record<ContentKind, MessageKey> = { live: 'tab.live', vod: 'tab.movies', series: 'tab.series' };
const MAX_UNDO = 20;
/** Categories outside any group. Not a real label, so it's never remembered as a rule. */
const OTHER = '';

type Row = { group: CategoryGroup<CategoryRow> } | { category: CategoryRow; child: boolean };

interface Saved {
  ids: string[];
  rule: HiddenRule;
}

/** Settings → Hidden categories: choose which categories a library shows, a group at a time. */
export function HiddenCategoriesScreen(props: { kind: ContentKind }): JSX.Element {
  const { hidden, rule, setHidden } = useHiddenCategories(props.kind);
  const [cats, setCats] = createSignal<CategoryRow[]>([]);
  const [query, setQuery] = createSignal('');
  const [open, setOpen] = createSignal<string[]>([]);
  const [undo, setUndo] = createSignal<Saved[]>([]);
  let list: VirtualListApi | undefined;

  // With a PIN set, what's hidden stays hidden from whoever doesn't know it.
  onMount(() => {
    void ensureUnlocked().then((ok) => {
      if (!ok) goBack();
    });
  });

  createEffect(
    on(
      () => activePlaylist()?.id,
      (id) => {
        if (!id) return setCats([]);
        listCategories(id, props.kind).then(setCats, (e) => log.warn('categories', 'could not list', { error: e }));
      },
    ),
  );

  const { names } = useCategoryNames(props.kind);
  const providerName = (c: CategoryRow) => (c.id === UNCATEGORIZED ? t('live.uncategorized') : c.name);
  const nameOf = (c: CategoryRow) => names()[c.id] ?? providerName(c);
  const grouped = createMemo(() => groupsFor(cats()));
  const groups = createMemo<Array<CategoryGroup<CategoryRow>>>(() => {
    const found = grouped();
    if (!found) return [];
    return found.other.length ? found.groups.concat({ key: OTHER, label: t('hidden.other'), items: found.other }) : found.groups;
  });

  /** Words many categories share, as one-press filters. Only with grouping on, and only when there are any. */
  const tags = createMemo(() => (categoryGrouping() === 'off' ? [] : detectTags(cats().map((c) => ({ id: c.id, name: providerName(c) })))));

  const rows = createMemo<Row[]>(() => {
    const match = makeMatcher(query());
    if (match) return cats().filter((c) => match(normalizeText(nameOf(c))) || match(normalizeText(providerName(c)))).map((category) => ({ category, child: false }));
    if (!groups().length) return cats().map((category) => ({ category, child: false }));
    const out: Row[] = [];
    for (const group of groups()) {
      out.push({ group });
      if (open().indexOf(group.key) >= 0) for (const category of group.items) out.push({ category, child: true });
    }
    return out;
  });

  const isHidden = (id: string) => hidden().indexOf(id) >= 0;
  const hiddenIn = (group: CategoryGroup<CategoryRow>) => group.items.filter((c) => isHidden(c.id)).length;

  /** The rule, with the filters it already had. */
  const ruleOf = (labels: string[], shown: string[], tagKeys: string[] = rule().tags ?? []): HiddenRule => ({ labels, shown, tags: tagKeys });
  const tagHidden = (tag: { ids: string[] }) => tag.ids.every((id) => isHidden(id));

  const save = (ids: string[], next: HiddenRule) => {
    setUndo((u) => u.concat({ ids: hidden(), rule: rule() }).slice(-MAX_UNDO));
    setHidden(ids, next);
  };

  const toggleCategory = (c: CategoryRow) => {
    const byTag = tagWords(c.name).some((w) => (rule().tags ?? []).indexOf(w) >= 0);
    const inRule = rule().labels.indexOf(groupKey(c.name) ?? OTHER) >= 0 || byTag;
    if (isHidden(c.id)) {
      // Shown by hand inside a hidden group or filter: remember that, or a refresh would hide it again.
      save(hidden().filter((id) => id !== c.id), ruleOf(rule().labels, inRule ? rule().shown.concat(c.id) : rule().shown));
    } else {
      save(hidden().concat(c.id), ruleOf(rule().labels, rule().shown.filter((id) => id !== c.id)));
    }
  };

  const toggleGroup = (group: CategoryGroup<CategoryRow>) => {
    const ids = group.items.map((c) => c.id);
    const shown = rule().shown.filter((id) => ids.indexOf(id) < 0);
    const labels = rule().labels.filter((l) => l !== group.key);
    if (hiddenIn(group) === group.items.length) {
      save(hidden().filter((id) => ids.indexOf(id) < 0), ruleOf(labels, shown));
    } else {
      const others = hidden().filter((id) => ids.indexOf(id) < 0);
      save(others.concat(ids), ruleOf(group.key === OTHER ? labels : labels.concat(group.key), shown));
    }
  };

  const toggleTag = (tag: { key: string; ids: string[] }) => {
    const shown = rule().shown.filter((id) => tag.ids.indexOf(id) < 0);
    const others = (rule().tags ?? []).filter((k) => k !== tag.key);
    if (tagHidden(tag)) {
      save(hidden().filter((id) => tag.ids.indexOf(id) < 0), ruleOf(rule().labels, shown, others));
    } else {
      save(hidden().filter((id) => tag.ids.indexOf(id) < 0).concat(tag.ids), ruleOf(rule().labels, shown, others.concat(tag.key)));
    }
  };

  const hideAll = () => save(cats().map((c) => c.id), ruleOf(groups().map((g) => g.key).filter((k) => k !== OTHER), [], []));
  const showAll = () => save([], ruleOf([], [], []));
  const undoLast = () => {
    const last = undo()[undo().length - 1];
    if (!last) return;
    setUndo((u) => u.slice(0, -1));
    setHidden(last.ids, last.rule);
  };

  const setOpenGroup = (key: string, isOpen: boolean) => setOpen((o) => (isOpen ? o.concat(key) : o.filter((k) => k !== key)));

  /** The first category with a different first letter, in that direction. */
  const letterJump = (from: number, step: 1 | -1): number | null => {
    const letter = (i: number) => {
      const row = rows()[i];
      return row && 'category' in row ? normalizeText(nameOf(row.category)).charAt(0) : '';
    };
    let i = from + step;
    if (step === -1 && letter(i) === letter(from)) {
      while (i > 0 && letter(i - 1) === letter(from)) i--;
      return i;
    }
    while (i >= 0 && i < rows().length && letter(i) === letter(from)) i += step;
    if (i < 0 || i >= rows().length) return null;
    if (step === -1) while (i > 0 && letter(i - 1) === letter(i)) i--;
    return i;
  };

  useKeys((press) => {
    if ((press.key !== 'left' && press.key !== 'right') || !list) return false;
    const index = list.focusedIndex();
    const row = index === null ? undefined : rows()[index];
    if (index === null || !row) return false;
    const right = press.key === 'right';
    if ('group' in row) {
      const isOpen = open().indexOf(row.group.key) >= 0;
      if (right && !isOpen) setOpenGroup(row.group.key, true);
      else if (!right && isOpen) setOpenGroup(row.group.key, false);
      return true;
    }
    if (row.child) {
      if (right) return true;
      // Back up to the group it's in, and close it.
      for (let i = index - 1; i >= 0; i--) {
        const above = rows()[i];
        if (above && 'group' in above) {
          const key = above.group.key;
          const target = i;
          list.focusIndex(target);
          setOpenGroup(key, false);
          break;
        }
      }
      return true;
    }
    if (query()) return false;
    const target = letterJump(index, right ? 1 : -1);
    if (target !== null) list.focusIndex(target);
    return true;
  });

  const MODES: CategoryGrouping[] = ['auto', 'on', 'off'];
  const cycleGrouping = () => setCategoryGrouping(MODES[(MODES.indexOf(categoryGrouping()) + 1) % MODES.length]);

  const rowClass = (row: Row) => {
    if ('group' in row) return hiddenIn(row.group) === row.group.items.length ? 'list-item hidden-group is-off' : 'list-item hidden-group';
    return `list-item${row.child ? ' hidden-child' : ''}${isHidden(row.category.id) ? ' is-off' : ''}`;
  };

  return (
    <div class="screen hidden-categories">
      <div class="screen-header-row">
        <div class="title-with-back">
          <BackButton />
          <h1 class="screen-title">{t('hidden.pageTitle', { library: t(TITLES[props.kind]) })}</h1>
        </div>
        <span class="pill pill-accent">{t('hidden.count', { n: formatNumber(hidden().length), total: formatNumber(cats().length) })}</span>
      </div>
      <p class="setting-desc hidden-note">{t(groups().length ? 'hidden.noteGroups' : 'hidden.noteLetters')}</p>
      <FocusZone id="hidden-tools">
        <div class="pane-tools">
          <TextField id="hidden-search" compact label={t('search.categories')} value={query()} onChange={setQuery} />
          {/* These stay in place even with nothing to do: a button that disappears would lose the remote's focus. */}
          <FocusButton id="hidden-top" onSelect={() => list?.focusIndex(0)}>
            {t('hidden.top')}
          </FocusButton>
          <FocusButton id="hidden-hide-all" onSelect={hideAll}>
            {t('hidden.hideAll')}
          </FocusButton>
          <FocusButton id="hidden-clear" onSelect={showAll}>
            {t('hidden.showAll')}
          </FocusButton>
          <FocusButton id="hidden-undo" onSelect={undoLast}>
            {t('hidden.undo')}
          </FocusButton>
          <FocusButton id="hidden-grouping" onSelect={cycleGrouping}>
            {t('hidden.grouping', { mode: t(`settings.grouping.${categoryGrouping()}`) })}
          </FocusButton>
        </div>
      </FocusZone>
      <Show when={tags().length}>
        <FocusZone id="hidden-filters">
          <div class="filter-row">
            <span class="filter-label">{t('hidden.filters')}</span>
            <For each={tags()}>
              {(tag) => (
                <FocusButton id={`hidden-tag-${tag.key.replace(/[^A-Z0-9]/g, '_')}`} class="filter-chip" selected={tagHidden(tag)} onSelect={() => toggleTag(tag)}>
                  <Icon name={tagHidden(tag) ? 'eyeOff' : 'check'} />
                  <span>{tag.key}</span>
                  <span class="filter-count">{formatNumber(tag.ids.length)}</span>
                </FocusButton>
              )}
            </For>
          </div>
        </FocusZone>
      </Show>
      <FocusZone id="hidden-list" remember>
        <div class="hidden-list">
          <VirtualList
            id="hidden-row"
            label={t(TITLES[props.kind])}
            items={rows()}
            rowHeight={3.2}
            autofocusIndex={0}
            ref={(api) => (list = api)}
            rowClass={rowClass}
            onSelect={(row) => ('group' in row ? toggleGroup(row.group) : toggleCategory(row.category))}
            empty={<p class="hint pane-empty">{t('search.noCategories')}</p>}
            renderRow={(row) =>
              'group' in row ? (
                <>
                  <Icon name={hiddenIn(row.group) === row.group.items.length ? 'radioOff' : 'checkCircle'} />
                  <span class="list-label">
                    <bdi>{row.group.label}</bdi>
                  </span>
                  <Show when={hiddenIn(row.group) > 0}>
                    <span class="pill">{hiddenIn(row.group) === row.group.items.length ? t('hidden.hidden') : t('hidden.groupSome', { n: formatNumber(hiddenIn(row.group)) })}</span>
                  </Show>
                  <span class="list-count">{t('hidden.groupCount', { n: formatNumber(row.group.items.length) })}</span>
                  <span
                    class="hidden-expand"
                    role="button"
                    aria-expanded={open().indexOf(row.group.key) >= 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenGroup(row.group.key, open().indexOf(row.group.key) < 0);
                    }}
                  >
                    <Icon name={open().indexOf(row.group.key) >= 0 ? 'up' : 'down'} />
                  </span>
                </>
              ) : (
                <>
                  <Icon name={isHidden(row.category.id) ? 'radioOff' : 'checkCircle'} />
                  <span class="list-label">
                    <bdi>{nameOf(row.category)}</bdi>
                  </span>
                  <Show when={isHidden(row.category.id)}>
                    <span class="pill">{t('hidden.hidden')}</span>
                  </Show>
                  <span class="list-count">{formatNumber(row.category.count)}</span>
                </>
              )
            }
          />
        </div>
      </FocusZone>
    </div>
  );
}
