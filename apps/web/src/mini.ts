import { $, api, playFrame, status } from './chirp';

type WebApp = {
  initData: string;
  initDataUnsafe: { user?: { first_name: string; last_name?: string; username?: string } };
  ready(): void;
  expand(): void;
  HapticFeedback?: { notificationOccurred(t: 'success' | 'error'): void };
  /** Bot API 8.0+: a home-screen shortcut straight into this Mini App. */
  addToHomeScreen?(): void;
  checkHomeScreenStatus?(cb: (status: 'unsupported' | 'unknown' | 'added' | 'missing') => void): void;
  onEvent?(event: 'homeScreenAdded', cb: () => void): void;
};
const tg = (window as unknown as { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp;

const ROLE_KEY = 'chirp.mini.role';
const roleInput = $('#role') as HTMLInputElement;
roleInput.value = localStorage.getItem(ROLE_KEY) ?? '';

if (!tg?.initData) {
  $('#name').textContent = 'Open this from Telegram';
  status($('#status'), 'This page needs to be opened from the Chirp bot (menu button “Chirp me”).', 'err');
  ($('#chirp') as HTMLButtonElement).disabled = true;
} else {
  tg.ready();
  tg.expand();
  const u = tg.initDataUnsafe.user;
  $('#name').textContent = u ? [u.first_name, u.last_name].filter(Boolean).join(' ') : 'You';
  $('#username').textContent = u?.username ? `@${u.username}` : 'No public username. They will still get your intro.';
}

/** After a first successful chirp, offer a home-screen icon so the next swap is two taps, not a search for the bot. */
function offerHomeScreen() {
  if (!tg?.addToHomeScreen || !tg.checkHomeScreenStatus) return;
  tg.checkHomeScreenStatus((s) => {
    if (s === 'missing') $('#home-row').hidden = false;
  });
}
$('#home').addEventListener('click', () => tg?.addToHomeScreen?.());
tg?.onEvent?.('homeScreenAdded', () => {
  $('#home-row').hidden = true;
  status($('#status'), 'Added. Chirp is on your home screen.', 'ok');
});

$('#chirp').addEventListener('click', async () => {
  const btn = $('#chirp') as HTMLButtonElement;
  btn.disabled = true;
  try {
    localStorage.setItem(ROLE_KEY, roleInput.value.trim());
    const { frame, expiresInS, lens } = await api<{ frame: string; expiresInS: number; lens: string }>('/api/handoff/connect', {
      body: { initData: tg!.initData, role: roleInput.value },
    });
    $('#lens').textContent = lens;
    status($('#status'), 'Chirping…');
    await playFrame(frame, { repeat: 2 });
    tg?.HapticFeedback?.notificationOccurred('success');
    status($('#status'), `Sent. Their lens shows your card for ${expiresInS} s. Tap again if they missed it.`, 'ok');
    offerHomeScreen();
  } catch (e) {
    tg?.HapticFeedback?.notificationOccurred('error');
    status($('#status'), String((e as Error).message), 'err');
  } finally {
    btn.disabled = false;
  }
});
