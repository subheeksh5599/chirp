// Every origin the packaged glasses app can reach must be on the manifest's network whitelist,
// and every whitelisted origin must actually be used (the store rejects unused permissions).
// It reads the built bundle, so it sees exactly what ships, including VITE_ values baked in.
//
//   npm run build -w @chirp/glasses && node scripts/check-network-whitelist.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ORIGIN = /https?:\/\/[A-Za-z0-9.-]+(?::\d+)?/g;

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(js|html|css)$/.test(n) ? [p] : [];
  });
}

export function checkWhitelist(appDir = 'apps/glasses') {
  const manifest = JSON.parse(readFileSync(join(appDir, 'app.json'), 'utf8'));
  const network = manifest.permissions?.find((p) => p.name === 'network');
  const whitelist = new Set(network?.whitelist ?? []);
  const used = new Map(); // origin -> first file it appears in
  const dist = join(appDir, 'dist');
  const built = (() => {
    try {
      return files(dist);
    } catch {
      return [];
    }
  })();
  if (!built.length) return { ok: false, problems: [`no build found in ${dist}; run the glasses build first`], used: [] };
  for (const f of built) {
    for (const m of readFileSync(f, 'utf8').matchAll(ORIGIN)) {
      if (!used.has(m[0])) used.set(m[0], relative(appDir, f));
    }
  }
  const problems = [];
  for (const [origin, file] of used) {
    if (!whitelist.has(origin)) problems.push(`${origin} is used in ${file} but is not in app.json network.whitelist`);
  }
  for (const origin of whitelist) {
    if (!used.has(origin)) problems.push(`${origin} is whitelisted in app.json but the app never calls it`);
  }
  if (used.size && !network) problems.push('the app calls the network but app.json has no network permission');
  return { ok: problems.length === 0, problems, used: [...used.keys()] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = checkWhitelist(process.argv[2]);
  if (!r.ok) {
    for (const p of r.problems) console.error(`✗ ${p}`);
    process.exit(1);
  }
  console.log(`✓ network whitelist matches the build: ${r.used.join(', ')}`);
}
