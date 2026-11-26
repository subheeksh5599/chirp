import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { checkWhitelist } from '../check-network-whitelist.mjs';

const made: string[] = [];
function fixture(bundle: string, whitelist: string[] | null) {
  const dir = mkdtempSync(join(tmpdir(), 'chirp-wl-'));
  made.push(dir);
  const manifest = JSON.parse(readFileSync('apps/glasses/app.json', 'utf8'));
  manifest.permissions = manifest.permissions.filter((p: { name: string }) => p.name !== 'network');
  if (whitelist) manifest.permissions.push({ name: 'network', desc: 'test', whitelist });
  writeFileSync(join(dir, 'app.json'), JSON.stringify(manifest));
  mkdirSync(join(dir, 'dist'));
  writeFileSync(join(dir, 'dist', 'app.js'), bundle);
  return dir;
}
afterEach(() => made.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('network whitelist check', () => {
  // Check the build this commit produces, not whatever dist/ a previous run left behind (or none, on a fresh clone).
  beforeAll(() => {
    // vitest sets NODE_ENV=test, which makes Vite emit a dev-flavoured bundle; check the production one.
    execFileSync('npm', ['run', 'build', '-w', '@chirp/glasses'], { stdio: 'ignore', env: { ...process.env, NODE_ENV: 'production' } });
  }, 120_000);

  it('the real glasses build calls only whitelisted origins, and uses every one', () => {
    const r = checkWhitelist('apps/glasses');
    expect(r.problems).toEqual([]);
    expect(r.used).toEqual(['https://chirp-liart-six-38.vercel.app']);
  });

  it('fails, naming the origin, when the bundle calls a host that is not whitelisted', () => {
    const r = checkWhitelist(fixture('fetch("https://api.example.com/x");fetch("https://ok.example")', ['https://ok.example']));
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(['https://api.example.com is used in dist/app.js but is not in app.json network.whitelist']);
  });

  it('fails when a whitelisted origin is never used', () => {
    const r = checkWhitelist(fixture('fetch("https://ok.example")', ['https://ok.example', 'https://stale.example']));
    expect(r.problems).toEqual(['https://stale.example is whitelisted in app.json but the app never calls it']);
  });

  it('fails when the app calls out with no network permission at all', () => {
    const r = checkWhitelist(fixture('fetch("https://ok.example")', null));
    expect(r.problems).toContain('the app calls the network but app.json has no network permission');
  });

  it('refuses to pass when there is no build to inspect', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chirp-wl-'));
    made.push(dir);
    cpSync('apps/glasses/app.json', join(dir, 'app.json'));
    expect(checkWhitelist(dir).ok).toBe(false);
  });
});
