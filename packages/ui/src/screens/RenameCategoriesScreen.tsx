import { listCategories, log, UNCATEGORIZED, type CategoryRow } from '@ultra/core';
import { createEffect, createMemo, createSignal, on, Show, type JSX } from 'solid-js';
import { BackButton } from '../components/BackButton';
import { Icon } from '../components/Icon';
import { RenameDialog } from '../components/RenameDialog';
import { TextField } from '../components/TextField';
import { VirtualList } from '../components/VirtualList';
import { makeMatcher, normalizeText, useCategoryNames } from '../data/categories';
import { activePlaylist } from '../data/playlists';
import { FocusZone } from '../focus';
import { formatNumber, t } from '../i18n';

/** Settings → Browsing → Rename categories: Live categories under names of the user's choosing. */
export function RenameCategoriesScreen(): JSX.Element {
  const { names, rename } = useCategoryNames('live');
  const [cats, setCats] = createSignal<CategoryRow[]>([]);
  const [query, setQuery] = createSignal('');
  const [editing, setEditing] = createSignal<CategoryRow | null>(null);

  createEffect(
    on(
      () => activePlaylist()?.id,
      (id) => {
        if (!id) return setCats([]);
        listCategories(id, 'live').then(setCats, (e) => log.warn('categories', 'could not list', { error: e }));
      },
    ),
  );

  const original = (c: CategoryRow) => (c.id === UNCATEGORIZED ? t('live.uncategorized') : c.name);
  const shown = (c: CategoryRow) => names()[c.id] ?? original(c);
  const renamedCount = () => cats().filter((c) => names()[c.id]).length;

  const rows = createMemo(() => {
    const match = makeMatcher(query());
    if (!match) return cats();
    return cats().filter((c) => match(normalizeText(shown(c))) || match(normalizeText(original(c))));
  });

  return (
    <div class="screen hidden-categories">
      <div class="screen-header-row">
        <div class="title-with-back">
          <BackButton />
          <h1 class="screen-title">{t('rename.pageTitle')}</h1>
        </div>
        <span class="pill pill-accent">{t('rename.count', { n: formatNumber(renamedCount()) })}</span>
      </div>
      <p class="setting-desc hidden-note">{t('rename.note')}</p>
      <FocusZone id="rename-tools">
        <div class="pane-tools">
          <TextField id="rename-search" compact label={t('search.categories')} value={query()} onChange={setQuery} />
        </div>
      </FocusZone>
      <FocusZone id="rename-list" remember>
        <div class="hidden-list">
          <VirtualList
            id="rename-row"
            label={t('rename.pageTitle')}
            items={rows()}
            rowHeight={3.6}
            autofocusIndex={0}
            rowClass={(c) => (names()[c.id] ? 'list-item is-selected' : 'list-item')}
            onSelect={(c) => setEditing(c)}
            empty={<p class="hint pane-empty">{t('search.noCategories')}</p>}
            renderRow={(c) => (
              <>
                <span class="channel-text">
                  <span class="list-label">
                    <bdi>{shown(c)}</bdi>
                  </span>
                  <Show when={names()[c.id]}>
                    <span class="rename-was">
                      <bdi>{original(c)}</bdi>
                    </span>
                  </Show>
                </span>
                <Icon name="edit" />
              </>
            )}
          />
        </div>
      </FocusZone>
      <Show when={editing()}>
        {(c) => (
          <RenameDialog
            id="rename-dialog"
            original={original(c())}
            current={shown(c())}
            renamed={!!names()[c().id]}
            onSave={(name) => {
              void rename(c().id, name);
              setEditing(null);
            }}
            onReset={() => {
              void rename(c().id, null);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        )}
      </Show>
    </div>
  );
}
