import { $, api, playFrame, status } from './chirp';

type WebApp = {
  initData: string;
  initDataUnsafe: { user?: { first_name: string; last_name?: string; username?: string } };
  ready(): void;
  expand(): void;
  HapticFeedback?: { notificationOccurred(t: 'success' | 'error'): void };
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
  $('#username').textContent = u?.username ? `@${u.username}` : 'no public username: they will still get your intro';
}

$('#chirp').addEventListener('click', async () => {
  const btn = $('#chirp') as HTMLButtonElement;
  btn.disabled = true;
  try {
    localStorage.setItem(ROLE_KEY, roleInput.value.trim());
    const { frame, expiresInS } = await api<{ frame: string; expiresInS: number }>('/api/handoff/connect', {
      body: { initData: tg!.initData, role: roleInput.value },
    });
    status($('#status'), 'Chirping…');
    btn.classList.add('pulse');
    await playFrame(frame, { repeat: 2 });
    tg?.HapticFeedback?.notificationOccurred('success');
    status($('#status'), `Sent. Their lens shows your card for ${expiresInS} s. Tap again if they missed it.`, 'ok');
  } catch (e) {
    tg?.HapticFeedback?.notificationOccurred('error');
    status($('#status'), String((e as Error).message), 'err');
  } finally {
    btn.classList.remove('pulse');
    btn.disabled = false;
  }
});
