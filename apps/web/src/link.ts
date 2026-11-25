import { $, api, playFrame, status } from './chirp';

let frame = '';
const val = (id: string) => ($(id) as HTMLInputElement).value.trim();

async function chirp() {
  status($('#status'), 'Chirping…');
  await playFrame(frame, { repeat: 2 });
  status($('#status'), `Chirped at ${new Date().toLocaleTimeString()}. Chirp again for anyone who joined late.`, 'ok');
}

$('#chirp').addEventListener('click', async () => {
  const btn = $('#chirp') as HTMLButtonElement;
  btn.disabled = true;
  try {
    const r = await api<{ frame: string }>('/api/handoff/link', {
      body: {
        title: val('#title'),
        url: val('#url') || undefined,
        note: val('#note') || undefined,
        from: val('#from') || undefined,
        minutes: Number(val('#minutes')) || 10,
      },
    });
    frame = r.frame;
    $('#again').classList.remove('hidden');
    await chirp();
  } catch (e) {
    status($('#status'), String((e as Error).message), 'err');
  } finally {
    btn.disabled = false;
  }
});
$('#again').addEventListener('click', () => frame && void chirp());
