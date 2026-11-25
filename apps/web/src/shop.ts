import { $, api, playFrame, status } from './chirp';

let bill: { frame: string; payId: string; lens: string } | null = null;
let poll: number | undefined;

const SHOP_KEY = 'chirp.shop.name';
($('#shop') as HTMLInputElement).value = localStorage.getItem(SHOP_KEY) ?? '';

async function chirp() {
  if (!bill) return;
  status($('#pay-status'), 'Chirping…');
  await playFrame(bill.frame, { repeat: 2 });
  status($('#pay-status'), 'Chirped. The bill code stays valid for 60 seconds.');
}

async function check() {
  if (!bill) return;
  try {
    const r = await api<{ paid: boolean; tx?: string; amountTon: number; shop: string }>(`/api/pay/${bill.payId}`);
    if (r.paid) {
      clearInterval(poll);
      poll = undefined;
      const el = $('#pay-status');
      el.replaceChildren();
      el.dataset.kind = 'ok';
      el.append(`Paid ${r.amountTon} TON. `);
      const a = document.createElement('a');
      a.href = r.tx!;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'view on testnet explorer';
      el.append(a);
    }
  } catch (e) {
    status($('#pay-status'), String((e as Error).message), 'err');
  }
}

$('#chirp').addEventListener('click', async () => {
  const btn = $('#chirp') as HTMLButtonElement;
  btn.disabled = true;
  try {
    const shop = ($('#shop') as HTMLInputElement).value.trim();
    localStorage.setItem(SHOP_KEY, shop);
    const amountTon = Number(($('#amount') as HTMLInputElement).value);
    const memo = ($('#memo') as HTMLInputElement).value.trim() || undefined;
    bill = await api<{ frame: string; payId: string; lens: string }>('/api/handoff/bill', { body: { shop, amountTon, memo } });
    $('#lens').textContent = bill.lens;
    $('#form').classList.add('hidden');
    $('#waiting').classList.remove('hidden');
    await chirp();
    poll = window.setInterval(() => void check(), 5000);
  } catch (e) {
    status($('#status'), String((e as Error).message), 'err');
  } finally {
    btn.disabled = false;
  }
});

$('#again').addEventListener('click', () => void chirp());
$('#reset').addEventListener('click', () => {
  clearInterval(poll);
  bill = null;
  $('#waiting').classList.add('hidden');
  $('#form').classList.remove('hidden');
  status($('#status'), '');
});
