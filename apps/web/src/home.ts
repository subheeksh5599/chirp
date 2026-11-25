import { $, api, playFrame } from './chirp';

// The bot's username comes from the server, which reads it from its own Telegram token.
api<{ bot: string }>('/api/config')
  .then(({ bot }) => (($('#bot') as HTMLAnchorElement).href = `https://t.me/${bot}`))
  .catch(() => undefined); // keeps the in-page fallback link, which explains how to open the bot

$('#console').addEventListener('click', () => (location.href = '/console.html'));

// Plays the sound-test frame: the glasses answer with "Sound test heard".
$('#hear').addEventListener('click', async () => {
  const btn = $('#hear') as HTMLButtonElement;
  btn.disabled = true;
  try {
    await playFrame('HTEST0000');
  } finally {
    btn.disabled = false;
  }
});
