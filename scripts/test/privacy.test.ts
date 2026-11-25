import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const privacy = readFileSync('apps/web/privacy.html', 'utf8');
const manifest = JSON.parse(readFileSync('apps/glasses/app.json', 'utf8'));

/** Hosts the server calls: fetch() targets and API base constants in server/*.ts. */
function serverHosts() {
  const hosts = new Set<string>();
  for (const f of readdirSync('server').filter((n) => n.endsWith('.ts'))) {
    for (const line of readFileSync(`server/${f}`, 'utf8').split('\n')) {
      if (!/fetch\(|const [A-Z_]+ = '/.test(line)) continue;
      for (const m of line.matchAll(/https:\/\/([a-z0-9.-]+)/g)) hosts.add(m[1]);
    }
  }
  return [...hosts].sort();
}

describe('privacy policy', () => {
  it('names every host the server calls', () => {
    const hosts = serverHosts();
    expect(hosts).toEqual(['api.groq.com', 'api.telegram.org', 'gamma-api.polymarket.com', 'testnet.toncenter.com']);
    for (const h of hosts) expect(privacy, `privacy.html does not name ${h}`).toContain(h);
  });

  it('names the backend the glasses are whitelisted to reach', () => {
    const net = manifest.permissions.find((p: { name: string }) => p.name === 'network');
    for (const origin of net.whitelist) expect(privacy).toContain(new URL(origin).host);
  });

  it('covers every permission the manifest asks for', () => {
    const covers: Record<string, RegExp> = {
      network: /talks to one server/,
      'g2-microphone': /glasses app listens/,
      'phone-microphone': /phone microphone is used only/,
    };
    for (const p of manifest.permissions) expect(privacy, `nothing covers ${p.name}`).toMatch(covers[p.name]);
  });
});
