import { listCategories, log, UNCATEGORIZED, type CategoryRow, type ContentKind } from '@ultra/core';
import { createEffect, createMemo, createSignal, on, Show, type JSX } from 'solid-js';
import { BackButton } from '../components/BackButton';
import { FocusButton } from '../components/FocusButton';
import { Icon } from '../components/Icon';
import { TextField } from '../components/TextField';
import { VirtualList } from '../components/VirtualList';
import { makeMatcher, normalizeText, useHiddenCategories } from '../data/categories';
import { activePlaylist } from '../data/playlists';
import { FocusZone } from '../focus';
import { formatNumber, t, type MessageKey } from '../i18n';

const TITLES: Record<ContentKind, MessageKey> = { live: 'tab.live', vod: 'tab.movies', series: 'tab.series' };

/** Settings → Hidden categories: choose which categories a library shows. */
export function HiddenCategoriesScreen(props: { kind: ContentKind }): JSX.Element {
  const { hidden, setHidden } = useHiddenCategories(props.kind);
  const [cats, setCats] = createSignal<CategoryRow[]>([]);
  const [query, setQuery] = createSignal('');

  createEffect(
    on(
      () => activePlaylist()?.id,
      (id) => {
        if (!id) return setCats([]);
        listCategories(id, props.kind).then(setCats, (e) => log.warn('categories', 'could not list', { error: e }));
      },
    ),
  );

  const nameOf = (c: CategoryRow) => (c.id === UNCATEGORIZED ? t('live.uncategorized') : c.name);
  const shown = createMemo(() => {
    const match = makeMatcher(query());
    return match ? cats().filter((c) => match(normalizeText(nameOf(c)))) : cats();
  });
  const isHidden = (id: string) => hidden().indexOf(id) >= 0;
  const toggle = (c: CategoryRow) => setHidden(isHidden(c.id) ? hidden().filter((id) => id !== c.id) : hidden().concat(c.id));

  return (
    <div class="screen hidden-categories">
      <div class="screen-header-row">
        <div class="title-with-back">
          <BackButton />
          <h1 class="screen-title">{t('hidden.pageTitle', { library: t(TITLES[props.kind]) })}</h1>
        </div>
        <span class="pill pill-accent">{t('hidden.count', { n: formatNumber(hidden().length), total: formatNumber(cats().length) })}</span>
      </div>
      <p class="setting-desc hidden-note">{t('hidden.note')}</p>
      <FocusZone id="hidden-tools">
        <div class="pane-tools">
          <TextField id="hidden-search" compact label={t('search.categories')} value={query()} onChange={setQuery} />
          <Show when={hidden().length > 0}>
            <FocusButton id="hidden-clear" class="hidden-clear" onSelect={() => setHidden([])}>
              {t('hidden.showAll')}
            </FocusButton>
          </Show>
        </div>
      </FocusZone>
      <FocusZone id="hidden-list" remember>
        <div class="hidden-list">
          <VirtualList
            id="hidden-row"
            label={t(TITLES[props.kind])}
            items={shown()}
            rowHeight={3.2}
            autofocusIndex={0}
            rowClass={(c) => (isHidden(c.id) ? 'list-item is-off' : 'list-item')}
            onSelect={toggle}
            empty={<p class="hint pane-empty">{t('search.noCategories')}</p>}
            renderRow={(c) => (
              <>
                <Icon name={isHidden(c.id) ? 'radioOff' : 'checkCircle'} />
                <span class="list-label">
                  <bdi>{nameOf(c)}</bdi>
                </span>
                <Show when={isHidden(c.id)}>
                  <span class="pill">{t('hidden.hidden')}</span>
                </Show>
                <span class="list-count">{formatNumber(c.count)}</span>
              </>
            )}
          />
        </div>
      </FocusZone>
    </div>
  );
}
