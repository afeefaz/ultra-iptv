/** The parts of Samsung's `webapis.avplay` used here. Times are milliseconds. */
export interface AvPlay {
  open(url: string): void;
  close(): void;
  prepareAsync(ok: () => void, fail: (e: unknown) => void): void;
  play(): void;
  pause(): void;
  stop(): void;
  seekTo(ms: number, ok?: () => void, fail?: (e: unknown) => void): void;
  suspend(): void;
  restore(): void;
  getCurrentTime(): number;
  getDuration(): number;
  setListener(listener: AvPlayListener): void;
  setDisplayRect(x: number, y: number, width: number, height: number): void;
  setDisplayMethod(method: string): void;
  setBufferingParam(option: string, unit: string, amount: number): void;
  setStreamingProperty(name: string, value: string): void;
  getTotalTrackInfo(): AvPlayTrack[];
  getCurrentStreamInfo(): AvPlayTrack[];
  setSelectTrack(type: 'AUDIO' | 'TEXT', index: number): void;
  setSilentSubtitle(silent: boolean): void;
}

export interface AvPlayTrack {
  type: string;
  index: number;
  /** A JSON string; its fields differ per track type. */
  extra_info: string;
}

export interface AvPlayListener {
  onbufferingstart?: () => void;
  onbufferingcomplete?: () => void;
  oncurrentplaytime?: (ms: number) => void;
  onstreamcompleted?: () => void;
  onerror?: (type: string) => void;
  onsubtitlechange?: (durationMs: number, text: string) => void;
}

export interface TizenGlobals {
  tizen?: {
    tvinputdevice?: {
      getSupportedKeys(): { name: string }[];
      registerKeyBatch(names: string[], ok?: () => void, fail?: (e: unknown) => void): void;
    };
    application?: { getCurrentApplication(): { exit(): void } };
    systeminfo?: {
      getCapability(key: string): string;
      getTotalMemory(): number;
      getAvailableMemory(): number;
    };
    filesystem?: {
      resolve(
        location: string,
        ok: (dir: { createFile(name: string): { openStream(mode: string, ok: (s: { write(text: string): void; close(): void }) => void, fail: (e: unknown) => void): void } }) => void,
        fail: (e: unknown) => void,
        mode: string,
      ): void;
    };
  };
  webapis?: {
    avplay?: AvPlay;
    productinfo?: { getRealModel(): string };
  };
}

export const tizenGlobals = (): TizenGlobals => window as unknown as TizenGlobals;
