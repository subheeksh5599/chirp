// Counts what the simulator's glasses app heard during one phone trial, for MEASUREMENTS.md.
// Start it, then press "Chirp once" on the phone N times, at least 5 s apart. Each press plays two
// copies and the decoder drops the same code within 4 s, so one press counts at most once. It listens for 15 s per press, so a slow hand is not cut off.
//
//   node scripts/count-heard.mjs <presses> [label]      e.g. node scripts/count-heard.mjs 10 "phone, 30 cm"
// Needs the simulator running with --automation-port 9898 and the app paired.
const SIM = process.env.SIM ?? 'http://127.0.0.1:9898';
const presses = Number(process.argv[2]);
const label = process.argv[3] ?? 'trial';
if (!Number.isInteger(presses) || presses < 1) {
  console.error('usage: node scripts/count-heard.mjs <presses> [label]');
  process.exit(1);
}

const entries = async (since) => (await (await fetch(`${SIM}/api/console?since_id=${since}`)).json()).entries ?? [];
const start = (await entries(0)).reduce((m, e) => Math.max(m, e.id), -1) + 1;

console.log(`${label}: press "Chirp once" ${presses} times, at least 5 s apart (the same code within 4 s counts once). Listens for ${presses * 15} s.`);
const heard = [];
const deadline = Date.now() + presses * 15_000;
let since = start;
while (Date.now() < deadline && heard.length < presses) {
  await new Promise((r) => setTimeout(r, 1000));
  for (const e of await entries(since)) {
    since = Math.max(since, e.id + 1);
    const m = /\[chirp\] heard (\S+)/.exec(e.message);
    if (m) {
      heard.push(m[1]);
      console.log(`  heard ${heard.length}: ${m[1]}`);
    }
  }
}
console.log(`| ${label} | ${heard.length} of ${presses} |`);
