import { $, playFrame, status } from './chirp';

let timer: number | undefined;
let count = 0;

async function once() {
  const frame = ($('#frame') as HTMLInputElement).value.trim();
  const volume = Number(($('#volume') as HTMLInputElement).value) || 12;
  const repeat = Number(($('#repeat') as HTMLInputElement).value) || 2;
  const secs = await playFrame(frame, { volume, repeat });
  count++;
  status($('#status'), `#${count} chirped “${frame}” (${secs.toFixed(1)} s, volume ${volume}, ×${repeat})`, 'ok');
}

$('#play').addEventListener('click', () => void once());
$('#loop').addEventListener('click', () => {
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
    $('#loop').textContent = 'Chirp every 6 s';
    return;
  }
  void once();
  timer = window.setInterval(() => void once(), 6000);
  $('#loop').textContent = 'Stop';
});
