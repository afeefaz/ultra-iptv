import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** Native side: apps/android/android/app/src/main/java/com/ultraiptv/player/UltraPlayerPlugin.java */
export interface NativeTrack {
  id: string;
  label: string;
  lang?: string;
  selected: boolean;
}

export interface UltraPlayerPlugin {
  load(options: {
    url: string;
    container: 'hls' | 'ts' | 'progressive';
    live: boolean;
    startAt?: number;
    buffer: 'low' | 'balanced' | 'stable';
    userAgent?: string;
    referrer?: string;
  }): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seek(options: { seconds: number }): Promise<void>;
  /** CSS pixels relative to the WebView. `overlay`: above the page (preview); `behind`: full screen under a transparent page. */
  setRect(options: { mode: 'hidden' | 'overlay' | 'behind'; left?: number; top?: number; width?: number; height?: number }): Promise<void>;
  selectAudio(options: { id: string }): Promise<void>;
  selectText(options: { id: string | null }): Promise<void>;
  openExternal(options: { url: string; title: string }): Promise<void>;
  shareText(options: { filename: string; mimeType: string; text: string }): Promise<void>;
  systemUsage(): Promise<{ ramUsed: number; ramTotal: number; appUsed: number }>;
  /** Reads the URL for `seconds` and discards the data; 0 stops at the first response. */
  measureDownload(options: { url: string; seconds: number }): Promise<{ status: number; ttfbMs: number; bytes: number; ms: number }>;
  cancelDownload(): Promise<void>;
  addListener(event: 'downloadProgress', fn: (e: { bytes: number; ms: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'state', fn: (e: { state: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'error', fn: (e: { kind: string; fatal: boolean; message: string; httpStatus?: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'tracks', fn: (e: { audio: NativeTrack[]; text: NativeTrack[] }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'firstFrame', fn: () => void): Promise<PluginListenerHandle>;
  addListener(
    event: 'progress',
    fn: (e: { current: number; duration: number; width?: number; height?: number; bitrateKbps?: number; bufferSec?: number; droppedFrames?: number }) => void,
  ): Promise<PluginListenerHandle>;
}

export const UltraPlayer = registerPlugin<UltraPlayerPlugin>('UltraPlayer');
