import { parseDeck } from '@chirp/wire';
import { $, api, playFrame, status } from './chirp';

type Admin = {
  id: string;
  title: string;
  slides: Array<{ title: string; note?: string; poll?: { question: string; a: string; b: string } }>;
  currentSlide: number;
  ended: boolean;
  listeners: number;
  claims: number;
  votes: { a: number; b: number; total: number };
  chirp: { frame: string; validForMs: number } | null;
  caption: string | null;
};

const KEY = 'chirp.console.session';
let session: { id: string; adminSecret: string } | null = JSON.parse(localStorage.getItem(KEY) ?? 'null');
let state: Admin | null = null;
let timer: number | undefined;
let chirping = false;

const admin = () => api<Admin>(`/api/sessions/${session!.id}/admin`, { token: session!.adminSecret });

function show(s: Admin) {
  state = s;
  $('#setup').classList.add('hidden');
  $('#live').classList.remove('hidden');
  $('#live-title').textContent = s.title;
  $('#live-id').textContent = s.id;
  const slide = s.slides[s.currentSlide];
  $('#slide-title').textContent = slide.poll ? `Poll · ${slide.poll.question}` : slide.title;
  $('#slide-meta').textContent = `Slide ${s.currentSlide + 1} of ${s.slides.length}${slide.note ? ` · ${slide.note}` : ''}`;
  $('#listeners').textContent = String(s.listeners);
  $('#claims').textContent = String(s.claims);
  if (slide.poll) {
    $('#votes').textContent = `${s.votes.a} / ${s.votes.b}`;
    $('#votes-label').textContent = `${slide.poll.a} / ${slide.poll.b}`;
  } else {
    $('#votes').textContent = '–';
    $('#votes-label').textContent = 'no poll on this slide';
  }
  $('#caption').textContent = s.caption ?? '';
  ($('#prev') as HTMLButtonElement).disabled = s.currentSlide === 0 || s.ended;
  ($('#next') as HTMLButtonElement).disabled = s.currentSlide >= s.slides.length - 1 || s.ended;
  if (s.ended) {
    stopAuto();
    ($('#auto') as HTMLButtonElement).disabled = true;
    ($('#once') as HTMLButtonElement).disabled = true;
    ($('#end') as HTMLButtonElement).disabled = true;
    status($('#end-status'), 'Session ended. Listeners can now claim presence from their glasses.', 'ok');
  }
}

async function refresh() {
  try {
    show(await admin());
  } catch (e) {
    status($('#chirp-status'), String((e as Error).message), 'err');
  }
}

async function chirpNow() {
  if (chirping) return;
  chirping = true;
  try {
    const s = await admin(); // fresh code: codes rotate every 5 seconds
    show(s);
    if (!s.chirp) return;
    const volume = Math.min(40, Math.max(1, Number(($('#volume') as HTMLInputElement).value) || 12));
    status($('#chirp-status'), 'Chirping…');
    const secs = await playFrame(s.chirp.frame, { volume, repeat: 2 });
    status($('#chirp-status'), `Chirped at ${new Date().toLocaleTimeString()} (${secs.toFixed(1)} s)`, 'ok');
  } catch (e) {
    status($('#chirp-status'), String((e as Error).message), 'err');
  } finally {
    chirping = false;
  }
}

function stopAuto() {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
  $('#auto').textContent = 'Start chirping';
}

$('#auto').addEventListener('click', () => {
  if (timer !== undefined) return stopAuto();
  const secs = Math.max(8, Number(($('#interval') as HTMLInputElement).value) || 20);
  void chirpNow();
  timer = window.setInterval(() => void chirpNow(), secs * 1000);
  $('#auto').textContent = 'Stop chirping';
});
$('#once').addEventListener('click', () => void chirpNow());

async function go(delta: number) {
  if (!state) return;
  await api(`/api/sessions/${session!.id}/slide`, { token: session!.adminSecret, body: { index: state.currentSlide + delta } });
  await refresh();
  void chirpNow(); // late joiners and current listeners pick up the new slide right away
}
$('#prev').addEventListener('click', () => void go(-1));
$('#next').addEventListener('click', () => void go(1));

$('#end').addEventListener('click', async () => {
  if (!confirm('End the session? Listeners who stayed long enough can then claim presence.')) return;
  await api(`/api/sessions/${session!.id}/end`, { token: session!.adminSecret, body: {} });
  await refresh();
});

$('#create').addEventListener('click', async () => {
  const btn = $('#create') as HTMLButtonElement;
  btn.disabled = true;
  try {
    const slides = parseDeck(($('#deck') as HTMLTextAreaElement).value);
    const created = await api<{ id: string; adminSecret: string }>('/api/sessions', {
      body: {
        title: ($('#title') as HTMLInputElement).value,
        slides,
        deckUrl: ($('#deckUrl') as HTMLInputElement).value || undefined,
        channelUrl: ($('#channelUrl') as HTMLInputElement).value || undefined,
        rule: {
          minMinutes: Number(($('#minMinutes') as HTMLInputElement).value),
          minCodes: Number(($('#minCodes') as HTMLInputElement).value),
        },
      },
    });
    session = created;
    localStorage.setItem(KEY, JSON.stringify(created));
    startPolling();
  } catch (e) {
    status($('#setup-status'), String((e as Error).message), 'err');
  } finally {
    btn.disabled = false;
  }
});

// Live subtitles: 5-second clips from the speaker's microphone, transcribed on the server.
let recorder: MediaRecorder | null = null;
$('#subs').addEventListener('click', async () => {
  if (recorder) {
    recorder.stream.getTracks().forEach((t) => t.stop());
    recorder = null;
    $('#subs').textContent = 'Start subtitles';
    status($('#subs-status'), 'Subtitles off.');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
    const loop = () => {
      if (!recorder) return;
      const r = new MediaRecorder(stream, { mimeType: mime });
      const parts: Blob[] = [];
      r.ondataavailable = (e) => parts.push(e.data);
      r.onstop = async () => {
        loop();
        const blob = new Blob(parts, { type: mime });
        if (blob.size < 2000) return;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        const b64 = btoa(bin);
        try {
          const { text } = await api<{ text: string }>(`/api/sessions/${session!.id}/caption`, {
            token: session!.adminSecret,
            body: { audio: b64, mime },
          });
          if (text) $('#caption').textContent = text;
        } catch (e) {
          status($('#subs-status'), String((e as Error).message), 'err');
        }
      };
      r.start();
      setTimeout(() => r.state !== 'inactive' && r.stop(), 5000);
    };
    recorder = new MediaRecorder(stream);
    loop();
    $('#subs').textContent = 'Stop subtitles';
    status($('#subs-status'), 'Listening to your microphone. Subtitles appear on listeners’ lenses.', 'ok');
  } catch (e) {
    status($('#subs-status'), `Microphone unavailable: ${(e as Error).message}`, 'err');
  }
});

let polling: number | undefined;
function startPolling() {
  void refresh();
  polling ??= window.setInterval(() => void refresh(), 4000);
}

$('#new').addEventListener('click', () => {
  if (!confirm('Leave this session and set up a new one?')) return;
  localStorage.removeItem(KEY);
  location.reload();
});

if (session) startPolling();
