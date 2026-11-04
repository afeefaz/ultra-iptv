import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  CategoryRow,
  ChannelRow,
  DetailRow,
  ContentKind,
  EncryptedBlob,
  EpgRow,
  FavoriteRow,
  LockRow,
  LockType,
  PlaylistRecord,
  ProgressRow,
  ProgressKind,
  RecentRow,
  SeriesRow,
  VodRow,
} from './model';

export interface UltraDb extends DBSchema {
  keys: { key: string; value: CryptoKey };
  playlists: { key: string; value: PlaylistRecord };
  secrets: { key: string; value: EncryptedBlob };
  categories: { key: [string, ContentKind, string]; value: CategoryRow; indexes: { byPlaylistKind: [string, ContentKind] } };
  live: { key: [string, string]; value: ChannelRow; indexes: { byCat: string; byKey: [string, string] } };
  vod: { key: [string, string]; value: VodRow; indexes: { byCat: string; byKey: [string, string] } };
  series: { key: [string, string]; value: SeriesRow; indexes: { byCat: string } };
  favorites: { key: [string, ContentKind, string]; value: FavoriteRow; indexes: { byPlaylistKind: [string, ContentKind] } };
  // v2 (phase 2)
  epg: { key: [string, string]; value: EpgRow };
  recent: { key: [string, ContentKind, string]; value: RecentRow; indexes: { byPlaylistKind: [string, ContentKind] } };
  locks: { key: [string, LockType, string]; value: LockRow; indexes: { byPlaylist: string } };
  settings: { key: string; value: unknown };
  // v3 (phase 3)
  progress: { key: [string, ProgressKind, string]; value: ProgressRow; indexes: { byPlaylist: string } };
  details: { key: [string, string, string]; value: DetailRow };
}

export const DB_NAME = 'ultraiptv';
const DB_VERSION = 4;

let dbPromise: Promise<IDBPDatabase<UltraDb>> | null = null;
let dbName = DB_NAME;

/** Tests use a fresh database name per case. */
export function useDatabaseName(name: string): void {
  dbName = name;
  dbPromise = null;
}

export function openUltraDb(): Promise<IDBPDatabase<UltraDb>> {
  if (!dbPromise) {
    dbPromise = openDB<UltraDb>(dbName, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          db.createObjectStore('keys');
          db.createObjectStore('playlists', { keyPath: 'id' });
          db.createObjectStore('secrets');
          db.createObjectStore('categories', { keyPath: ['playlistId', 'kind', 'id'] }).createIndex('byPlaylistKind', [
            'playlistId',
            'kind',
          ]);
          for (const kind of ['live', 'vod', 'series'] as const) {
            db.createObjectStore(kind, { keyPath: ['playlistId', 'id'] }).createIndex('byCat', 'catKeys', { multiEntry: true });
          }
          db.createObjectStore('favorites', { keyPath: ['playlistId', 'kind', 'key'] }).createIndex('byPlaylistKind', [
            'playlistId',
            'kind',
          ]);
        }
        if (oldVersion < 2) {
          db.createObjectStore('epg', { keyPath: ['playlistId', 'streamId'] });
          db.createObjectStore('recent', { keyPath: ['playlistId', 'kind', 'key'] }).createIndex('byPlaylistKind', [
            'playlistId',
            'kind',
          ]);
          db.createObjectStore('locks', { keyPath: ['playlistId', 'type', 'id'] }).createIndex('byPlaylist', 'playlistId');
          db.createObjectStore('settings');
        }
        if (oldVersion < 3) {
          db.createObjectStore('progress', { keyPath: ['playlistId', 'kind', 'key'] }).createIndex('byPlaylist', 'playlistId');
          db.createObjectStore('details', { keyPath: ['playlistId', 'kind', 'id'] });
        }
        // v4: Home finds its channels and movies without reading the whole catalogue.
        if (oldVersion < 4) {
          tx.objectStore('live').createIndex('byKey', ['playlistId', 'key']);
          tx.objectStore('vod').createIndex('byKey', ['playlistId', 'key']);
        }
      },
      blocking() {
        // Another tab/worker needs a newer version: let it upgrade.
        void dbPromise?.then((db) => db.close());
        dbPromise = null;
      },
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

/** Key range covering every row of one playlist in a `[playlistId, id]` store. */
export const playlistRange = (playlistId: string) => IDBKeyRange.bound([playlistId, ''], [playlistId, '\uffff']);

export const categoryRange = (playlistId: string, kind: ContentKind) =>
  IDBKeyRange.bound([playlistId, kind, ''], [playlistId, kind, '\uffff']);
