import {
  deriveDeviceBoxes,
  DEVICE_TTL_SECONDS,
  newPlaylistId,
  normalizeDeviceId,
  normalizeDeviceKey,
  open,
  parseDeviceLink,
  RelayClient,
  seal,
  type DeviceBoxes,
  type RemotePlaylist,
  type RemoteState,
} from '@ultra/core/pair';

const DEVICES_KEY = 'ultra.tvs';

const strings = {
  en: {
    loginTitle: 'Manage a TV’s playlists',
    loginSub: 'Enter the device ID and key from the TV’s Settings, under Remote access, or scan its QR code.',
    deviceId: 'Device ID (MAC)',
    deviceKey: 'Device key',
    deviceName: 'Name (optional)',
    deviceNameHint: 'For example, Mum’s TV',
    badId: 'That ID doesn’t look right. It has 12 letters and numbers, like 02:AB:CD:EF:01:23.',
    badKey: 'That key doesn’t look right. It has 8 letters and numbers.',
    next: 'Continue',
    devices: 'Your TVs',
    addDevice: 'Add another TV',
    forget: 'Remove from this browser',
    forgetConfirm: 'Remove this TV from this browser? Its playlists stay saved, and you can add it again with its ID and key.',
    allDevices: 'All TVs',
    loading: 'Loading…',
    playlists: 'Playlists',
    nothingYet: 'Nothing saved for this TV yet. If it already has playlists, press Refresh on it to bring them here. If you expected some, check the ID and key.',
    none: 'No playlists yet.',
    add: 'Add playlist',
    edit: 'Edit',
    remove: 'Delete',
    removeConfirm: 'Delete “{name}”? It leaves the TV the next time someone presses Refresh on it.',
    saved: 'Saved. It reaches the TV when someone presses Refresh on it, whenever that is.',
    addTitle: 'Add playlist',
    editTitle: 'Edit playlist',
    formSub: 'It’s encrypted on this device before it’s saved, and only someone with the ID and key can read it.',
    xtream: 'Xtream Codes',
    m3u: 'M3U link',
    name: 'Name',
    server: 'Server',
    username: 'Username',
    password: 'Password',
    m3uUrl: 'Playlist link',
    save: 'Save',
    saving: 'Saving…',
    cancel: 'Cancel',
    noRelay: 'Couldn’t connect. Check your connection and try again.',
    required: 'Fill in every field.',
  },
  ar: {
    loginTitle: 'إدارة قوائم تشغيل التلفاز',
    loginSub: 'أدخل معرّف الجهاز والمفتاح من إعدادات التلفاز، ضمن الوصول عن بُعد، أو امسح رمز QR.',
    deviceId: 'معرّف الجهاز (MAC)',
    deviceKey: 'مفتاح الجهاز',
    deviceName: 'الاسم (اختياري)',
    deviceNameHint: 'مثل: تلفاز أمي',
    badId: 'المعرّف غير صحيح. يتكوّن من 12 حرفًا ورقمًا، مثل 02:AB:CD:EF:01:23.',
    badKey: 'المفتاح غير صحيح. يتكوّن من 8 أحرف وأرقام.',
    next: 'متابعة',
    devices: 'أجهزة التلفاز',
    addDevice: 'إضافة تلفاز آخر',
    forget: 'إزالة من هذا المتصفح',
    forgetConfirm: 'إزالة هذا التلفاز من هذا المتصفح؟ تبقى قوائم التشغيل محفوظة، ويمكنك إضافته مجددًا بالمعرّف والمفتاح.',
    allDevices: 'كل أجهزة التلفاز',
    loading: 'جارٍ التحميل…',
    playlists: 'قوائم التشغيل',
    nothingYet: 'لا يوجد شيء محفوظ لهذا التلفاز بعد. إذا كانت عليه قوائم تشغيل، فاضغط «تحديث» عليه لإحضارها إلى هنا. وإذا كنت تتوقع وجود قوائم، فتحقق من المعرّف والمفتاح.',
    none: 'لا توجد قوائم تشغيل بعد.',
    add: 'إضافة قائمة تشغيل',
    edit: 'تعديل',
    remove: 'حذف',
    removeConfirm: 'حذف «{name}»؟ ستُزال من التلفاز عند الضغط على «تحديث» عليه في المرة التالية.',
    saved: 'تم الحفظ. تصل إلى التلفاز عند الضغط على «تحديث» عليه، في أي وقت.',
    addTitle: 'إضافة قائمة تشغيل',
    editTitle: 'تعديل قائمة التشغيل',
    formSub: 'تُشفَّر البيانات على هذا الجهاز قبل حفظها، ولا يمكن قراءتها إلا لمن لديه المعرّف والمفتاح.',
    xtream: 'Xtream Codes',
    m3u: 'رابط M3U',
    name: 'الاسم',
    server: 'الخادم',
    username: 'اسم المستخدم',
    password: 'كلمة المرور',
    m3uUrl: 'رابط القائمة',
    save: 'حفظ',
    saving: 'جارٍ الحفظ…',
    cancel: 'إلغاء',
    noRelay: 'تعذر الاتصال. تحقق من اتصالك وحاول مجددًا.',
    required: 'املأ كل الحقول.',
  },
};
const isArabic = navigator.language.toLowerCase().startsWith('ar');
const text = strings[isArabic ? 'ar' : 'en'];
const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k]));

const relay = new RelayClient(location.origin);
const app = document.getElementById('app')!;

/** Bumped by every new view, so a slow load for an old one is ignored. */
let view = 0;

interface SavedDevice {
  id: string;
  key: string;
  /** Only ever in this browser. */
  label?: string;
}

function loadDevices(): SavedDevice[] {
  try {
    return JSON.parse(localStorage.getItem(DEVICES_KEY) ?? '[]') as SavedDevice[];
  } catch {
    return [];
  }
}

function saveDevices(devices: SavedDevice[]): void {
  try {
    localStorage.setItem(DEVICES_KEY, JSON.stringify(devices));
  } catch {
    // Private browsing: it works until the page closes, then enter them again.
  }
}

function rememberDevice(device: SavedDevice): void {
  const previous = loadDevices().filter((d) => d.id === device.id)[0];
  saveDevices([...loadDevices().filter((d) => d.id !== device.id), { ...device, label: device.label ?? previous?.label }]);
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  Object.assign(el, props);
  el.append(...children);
  return el;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = element('button', { type: 'button', className }, label);
  b.onclick = onClick;
  return b;
}

function field(label: string, id: string, attrs: Partial<HTMLInputElement> = {}): { row: HTMLElement; input: HTMLInputElement } {
  const input = element('input', { id, autocomplete: 'off', spellcheck: false, autocapitalize: 'off', ...attrs });
  input.dir = 'auto';
  const row = element('div', {}, element('label', { htmlFor: id }, label), input);
  return { row, input };
}

function heading(title: string, sub?: string): HTMLElement[] {
  const parts: HTMLElement[] = [element('h1', {}, title)];
  if (sub) parts.push(element('p', { className: 'sub' }, sub));
  return parts;
}

function notice(message: string, kind: '' | 'good' | 'bad' = ''): HTMLElement {
  const el = element('div', { className: `status ${kind}` }, message);
  el.setAttribute('role', 'status');
  return el;
}

function hostOf(p: RemotePlaylist): string {
  const raw = p.type === 'xtream' ? p.server : p.m3uUrl;
  try {
    return new URL(raw ?? '').host;
  } catch {
    return raw ?? '';
  }
}

function showLogin(error?: string): void {
  view++;
  const id = field(text.deviceId, 'device-id', { placeholder: '02:AB:CD:EF:01:23' });
  const key = field(text.deviceKey, 'device-key');
  const label = field(text.deviceName, 'device-name', { placeholder: text.deviceNameHint });
  id.input.dir = 'ltr';
  key.input.dir = 'ltr';
  const status = element('div', { className: 'status bad', hidden: !error }, error ?? '');
  const form = element('form', {}, id.row, key.row, label.row, element('button', { className: 'primary', type: 'submit' }, text.next), status);
  form.onsubmit = (e) => {
    e.preventDefault();
    const normalizedId = normalizeDeviceId(id.input.value);
    const normalizedKey = normalizeDeviceKey(key.input.value);
    if (!normalizedId || !normalizedKey) {
      status.textContent = normalizedId ? text.badKey : text.badId;
      status.hidden = false;
      return;
    }
    openDevice({ id: normalizedId, key: normalizedKey, label: label.input.value.trim() || undefined });
  };
  const back = loadDevices().length ? [button(text.allDevices, 'link', showHome)] : [];
  app.replaceChildren(...heading(text.loginTitle, text.loginSub), form, ...back);
  id.input.focus();
}

function openDevice(device: SavedDevice): void {
  // Neither is needed in the address any more, so they won't stay in history.
  history.replaceState(null, '', location.pathname);
  rememberDevice(device);
  void showDevice(device);
}

function showHome(): void {
  const devices = loadDevices();
  if (devices.length === 0) return showLogin();
  if (devices.length === 1) return void showDevice(devices[0]!);
  view++;
  const rows = devices.map((device) => button(device.label ?? device.id, 'row-button', () => void showDevice(device)));
  app.replaceChildren(...heading(text.devices), ...rows, button(text.addDevice, 'link', () => showLogin()));
}

/** The TV's list as last saved here or by the TV. Null if nothing has ever been saved. */
async function readPlaylists(boxes: DeviceBoxes): Promise<RemotePlaylist[] | null> {
  const sealed = await relay.get(boxes.stateBox);
  return sealed ? (await open<RemoteState>(boxes.key, sealed)).playlists : null;
}

/** Reads first, so a change made on the TV since this page loaded isn't lost. */
async function changePlaylists(boxes: DeviceBoxes, change: (list: RemotePlaylist[]) => RemotePlaylist[]): Promise<void> {
  const state: RemoteState = { playlists: change((await readPlaylists(boxes)) ?? []) };
  await relay.put(boxes.stateBox, await seal(boxes.key, state), DEVICE_TTL_SECONDS);
}

async function showDevice(device: SavedDevice, message?: HTMLElement): Promise<void> {
  const mine = ++view;
  const title = device.label ?? text.playlists;

  const footer = () => {
    const parts = [button(text.addDevice, 'link', () => showLogin())];
    if (loadDevices().length > 1) parts.unshift(button(text.allDevices, 'link', showHome));
    parts.push(
      button(text.forget, 'link', () => {
        if (!confirm(text.forgetConfirm)) return;
        saveDevices(loadDevices().filter((d) => d.id !== device.id));
        showHome();
      }),
    );
    return [element('div', { className: 'footer' }, ...parts)];
  };

  app.replaceChildren(...heading(title, text.loading));
  try {
    const boxes = await deriveDeviceBoxes(device.id, device.key);
    const playlists = await readPlaylists(boxes);
    if (mine !== view) return;
    const rows = (playlists ?? []).map((playlist) => {
      const details = element('div', { className: 'card-text' }, element('div', { className: 'card-name' }, playlist.name), element('div', { className: 'card-sub' }, hostOf(playlist)));
      const actions = element(
        'div',
        { className: 'card-actions' },
        button(text.edit, 'small', () => showForm(device, boxes, playlist)),
        button(text.remove, 'small danger', () => {
          if (!confirm(fill(text.removeConfirm, { name: playlist.name }))) return;
          void changePlaylists(boxes, (list) => list.filter((p) => p.id !== playlist.id)).then(
            () => showDevice(device, notice(text.saved, 'good')),
            () => alert(text.noRelay),
          );
        }),
      );
      return element('div', { className: 'card' }, details, actions);
    });
    const messages = message ? [message] : playlists ? [] : [notice(text.nothingYet)];
    const body = rows.length || !playlists ? rows : [element('p', { className: 'sub' }, text.none)];
    app.replaceChildren(...heading(title, device.id), ...messages, ...body, button(text.add, 'primary', () => showForm(device, boxes)), ...footer());
  } catch {
    if (mine === view) app.replaceChildren(...heading(title, device.id), notice(text.noRelay, 'bad'), ...footer());
  }
}

function showForm(device: SavedDevice, boxes: DeviceBoxes, existing?: RemotePlaylist): void {
  view++;
  let type: RemotePlaylist['type'] = existing?.type ?? 'xtream';
  const name = field(text.name, 'name', { value: existing?.name ?? 'IPTV' });
  const server = field(text.server, 'server', { type: 'url', placeholder: 'http://example.com:8080', value: existing?.server ?? '' });
  const username = field(text.username, 'username', { value: existing?.username ?? '' });
  const password = field(text.password, 'password', { value: existing?.password ?? '' });
  const m3u = field(text.m3uUrl, 'm3u', { type: 'url', placeholder: 'http://example.com/get.php?…', value: existing?.m3uUrl ?? '' });
  for (const f of [server, username, password, m3u]) f.input.dir = 'ltr';
  const xtreamRows = element('div', { hidden: type !== 'xtream' }, server.row, username.row, password.row);
  m3u.row.hidden = type !== 'm3u';

  const tab = (value: RemotePlaylist['type'], label: string) => {
    const b = element('button', { type: 'button' }, label);
    b.onclick = () => {
      type = value;
      xtreamButton.setAttribute('aria-pressed', String(type === 'xtream'));
      m3uButton.setAttribute('aria-pressed', String(type === 'm3u'));
      xtreamRows.hidden = type !== 'xtream';
      m3u.row.hidden = type !== 'm3u';
    };
    return b;
  };
  const xtreamButton = tab('xtream', text.xtream);
  const m3uButton = tab('m3u', text.m3u);
  xtreamButton.setAttribute('aria-pressed', String(type === 'xtream'));
  m3uButton.setAttribute('aria-pressed', String(type === 'm3u'));

  const status = element('div', { className: 'status bad', hidden: true });
  status.setAttribute('role', 'status');
  const say = (message: string) => {
    status.textContent = message;
    status.hidden = false;
  };
  const save = element('button', { className: 'primary', type: 'submit' }, text.save);
  const cancel = button(text.cancel, 'secondary', () => void showDevice(device));
  const form = element('form', {}, element('div', { className: 'tabs' }, xtreamButton, m3uButton), name.row, xtreamRows, m3u.row, save, cancel, status);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const common = { id: existing?.id ?? newPlaylistId(), name: name.input.value.trim(), userAgent: existing?.userAgent, refreshHours: existing?.refreshHours, epgOffsetHours: existing?.epgOffsetHours };
    const playlist: RemotePlaylist =
      type === 'xtream'
        ? { ...common, type, server: server.input.value.trim(), username: username.input.value.trim(), password: password.input.value }
        : { ...common, type, m3uUrl: m3u.input.value.trim() };
    const missing = type === 'xtream' ? !playlist.server || !playlist.username || !playlist.password : !playlist.m3uUrl;
    if (!playlist.name || missing) return say(text.required);
    save.disabled = true;
    save.textContent = text.saving;
    try {
      await changePlaylists(boxes, (list) => {
        const found = list.some((p) => p.id === playlist.id);
        return found ? list.map((p) => (p.id === playlist.id ? playlist : p)) : [...list, playlist];
      });
      void showDevice(device, notice(text.saved, 'good'));
    } catch {
      save.disabled = false;
      save.textContent = text.save;
      say(text.noRelay);
    }
  };

  app.replaceChildren(...heading(existing ? text.editTitle : text.addTitle, text.formSub), form);
  name.input.focus();
}

document.documentElement.lang = isArabic ? 'ar' : 'en';
if (isArabic) document.documentElement.dir = 'rtl';
const fromLink = parseDeviceLink(location.hash);
if (fromLink) openDevice(fromLink);
else showHome();
// A link opened while this page is already open only changes the fragment.
window.onhashchange = () => {
  const link = parseDeviceLink(location.hash);
  if (link) openDevice(link);
};
