import { Channel, invoke } from '@tauri-apps/api/core';

/**
 * The Mac app's native commands (apps/desktop/src-tauri/src): one place for their names and
 * argument shapes. Numbers are passed as plain numbers; Rust reads them as such.
 */

export interface MpvTrack {
  id: number;
  type: 'video' | 'audio' | 'sub';
  lang?: string | null;
  title?: string | null;
  codec?: string | null;
  channels?: number | null;
  selected?: boolean;
}

export type MpvEvent =
  | { t: 'prop'; name: string; value: unknown }
  | { t: 'start' }
  | { t: 'loaded' }
  | { t: 'restart' }
  | { t: 'end'; reason: number; error: string; httpStatus: number | null; cannotConnect: boolean };

export const native = {
  appInfo: () => invoke<{ version: string; osVersion?: string; model?: string; arch: string; os: string }>('app_info'),
  /** The answer comes back as raw "<status>\n<body>" text, not JSON. */
  async httpGet(url: string, headers: Record<string, string> | undefined, timeoutMs: number): Promise<{ status: number; body: string }> {
    const raw = await invoke<ArrayBuffer | string>('http_get', { url, headers: headers ?? null, timeoutMs });
    const text = typeof raw === 'string' ? raw : new TextDecoder('utf-8').decode(raw);
    const nl = text.indexOf('\n');
    return { status: Number(text.slice(0, nl)), body: text.slice(nl + 1) };
  },
  files: {
    write: (path: string, text: string) => invoke<void>('files_write', { path, text }),
    append: (path: string, text: string, start: boolean) => invoke<void>('files_append', { path, text, start }),
    readSlice: (path: string, offset: number, count: number) => invoke<string | null>('files_read_slice', { path, offset, count }),
    read: (path: string) => invoke<string | null>('files_read', { path }),
    removeDir: (path: string) => invoke<void>('files_remove_dir', { path }),
    freeBytes: () => invoke<number | null>('files_free_bytes'),
  },
  systemUsage: () => invoke<{ ramUsed: number; ramTotal: number; appUsed: number }>('system_usage'),
  measureDownload(url: string, seconds: number, onProgress: (p: { bytes: number; ms: number }) => void) {
    const channel = new Channel<{ bytes: number; ms: number }>();
    channel.onmessage = onProgress;
    return invoke<{ status: number; ttfbMs: number; bytes: number; ms: number }>('measure_download', { url, seconds, onProgress: channel });
  },
  cancelDownload: () => invoke<void>('cancel_download'),
  exportText: (filename: string, text: string) => invoke<void>('export_text', { filename, text }),
  setFullscreen: (on: boolean) => invoke<void>('set_fullscreen', { on }),
  keepAwake: (on: boolean) => invoke<void>('keep_awake', { on }),
  secretKey: () => invoke<number[]>('secret_key').then((bytes) => new Uint8Array(bytes)),
  updateInfo: () => invoke<{ versionCode: number; canInstall: boolean; blocker?: 'location' | null }>('update_info'),
  updateInstall(expectedVersion: string, onProgress: (percent: number) => void) {
    const channel = new Channel<number>();
    channel.onmessage = onProgress;
    return invoke<void>('update_install', { expectedVersion, onProgress: channel });
  },
  isFullscreen: () => invoke<boolean>('is_fullscreen'),
  mpv: {
    events(onEvent: (e: MpvEvent) => void) {
      const channel = new Channel<MpvEvent>();
      channel.onmessage = onEvent;
      return invoke<void>('mpv_events', { channel });
    },
    load: (o: { url: string; startAt?: number; buffer: string; userAgent?: string; referrer?: string }) =>
      invoke<void>('mpv_load', { url: o.url, startAt: o.startAt ?? null, buffer: o.buffer, userAgent: o.userAgent ?? null, referrer: o.referrer ?? null }),
    pause: (paused: boolean) => invoke<void>('mpv_pause', { paused }),
    stop: () => invoke<void>('mpv_stop'),
    seek: (seconds: number) => invoke<void>('mpv_seek', { seconds }),
    select: (kind: 'audio' | 'text', id: string | null) => invoke<void>('mpv_select', { kind, id }),
    setRect: (mode: 'hidden' | 'behind' | 'box', x = 0, y = 0, w = 0, h = 0) => invoke<void>('mpv_set_rect', { mode, x, y, w, h }),
  },
};
