import { $, api, playFrame, renderFrame, status, wavBlob } from './chirp';

type Market = { id: string; question: string; yes: number; volume24h: number };

const pct = (p: number) => `${Math.round(p * 100)}%`;
const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`);

async function mark(m: Market, li: HTMLLIElement, download: boolean) {
  const out = li.querySelector('.out') as HTMLElement;
  try {
    status(out, 'Creating marker…');
    const { frame } = await api<{ frame: string }>('/api/markers', { body: { marketId: m.id } });
    if (download) {
      const { samples, rate } = await renderFrame(frame, { repeat: 2 });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(wavBlob(samples, rate));
      a.download = `chirp-marker-${m.id}.wav`;
      a.click();
      status(out, 'Downloaded. The marker stays valid for 6 hours.', 'ok');
    } else {
      await playFrame(frame, { repeat: 2 });
      status(out, 'Chirped. Viewers’ lenses now show this market.', 'ok');
    }
  } catch (e) {
    status(out, String((e as Error).message), 'err');
  }
}

async function search() {
  const q = ($('#q') as HTMLInputElement).value.trim();
  const list = $('#results');
  list.replaceChildren();
  if (q.length < 2) return status($('#status'), 'Type at least 2 characters.', 'err');
  status($('#status'), 'Searching live markets…');
  try {
    const { markets } = await api<{ markets: Market[] }>(`/api/markets?q=${encodeURIComponent(q)}`);
    status($('#status'), markets.length ? '' : 'No live markets for that search.');
    for (const m of markets) {
      const li = document.createElement('li');
      li.className = 'result';
      const info = document.createElement('div');
      const title = document.createElement('div');
      title.textContent = m.question;
      const meta = document.createElement('div');
      meta.className = 'muted';
      meta.textContent = `Yes ${pct(m.yes)}, ${usd(m.volume24h)} traded in 24h`;
      const out = document.createElement('div');
      out.className = 'status out';
      info.append(title, meta, out);
      const play = document.createElement('button');
      play.textContent = 'Chirp';
      play.onclick = () => void mark(m, li, false);
      const dl = document.createElement('button');
      dl.className = 'ghost';
      dl.textContent = 'Download';
      dl.title = 'Download the chirp to mix into your stream';
      dl.onclick = () => void mark(m, li, true);
      li.append(info, play, dl);
      list.append(li);
    }
  } catch (e) {
    status($('#status'), String((e as Error).message), 'err');
  }
}

$('#search').addEventListener('click', () => void search());
$('#q').addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && void search());
