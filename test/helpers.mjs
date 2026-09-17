// Test harness: a real serve.mjs on a spare port, pointed at a throwaway brain and data folder, with a
// fake Claude, no clock and no usage calls. Nothing here can reach the owner's data, routines,
// connectors or Claude plan.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAKE = path.join(ROOT, 'test', 'fake-claude.mjs');
export const hash = text => crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 16);
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function scratch(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ao-test-${label}-`));
  const brain = path.join(dir, 'brain'), data = path.join(dir, 'data');
  fs.mkdirSync(path.join(brain, 'Agents Office'), { recursive: true });
  fs.mkdirSync(path.join(brain, '00-Meta'), { recursive: true });
  fs.mkdirSync(path.join(brain, '10-Business'), { recursive: true });
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(brain, 'CLAUDE.md'), '# Rules\nNever invent a figure, price, proof or policy.\n');
  fs.writeFileSync(path.join(brain, '00-Meta', 'company-stage.md'), '# Stage\nA fixture company for tests. Zero clients.\n');
  // a long price list whose last line used to be cut off by the old 4,500-character cap
  fs.writeFileSync(path.join(brain, '10-Business', 'offer-ladder.md'), '# Offer ladder\n' + 'Filler line about the fixture offer.\n'.repeat(210) + 'PRICE-AT-THE-END: fixture price row\n');
  fs.writeFileSync(path.join(brain, 'Agents Office', 'routines.json'), '{"routines": []}\n');
  return { dir, brain, data, cleanup: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} } };
}

export async function startOffice({ brain, data, env = {} }) {
  // Let the OS choose an available port, avoiding Windows' excluded/reserved port ranges.
  const probe = http.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const logFile = path.join(data, '..', `fake-claude-${port}.log`);
  const childEnv = { ...process.env, PORT: String(port), AO_DATA: data, AO_BRAIN: brain, AO_CLAUDE: FAKE, AO_CLOCK: 'off', AO_USAGE: 'off', AO_TIMEOUT_MS: '3000', FAKE_LOG: logFile, ...env };
  delete childEnv.ANTHROPIC_API_KEY; delete childEnv.AO_HOST; // always the CLI path, always loopback
  const p = spawn(process.execPath, ['serve.mjs'], { cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
  const exited = new Promise(r => p.on('exit', r));
  const base = `http://127.0.0.1:${port}`;
  let health = null;
  for (let i = 0; i < 120 && !health; i++) {
    if (p.exitCode !== null) break;
    try { const r = await fetch(base + '/api/health'); if (r.ok) { const candidate = await r.json(); if (candidate.instance?.pid === p.pid) health = candidate; } } catch {}
    if (!health) await sleep(150);
  }
  if (!health) { p.kill(); throw new Error('office did not start:\n' + out); }
  const api = async (method, url, bodyObj, headers = {}) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...headers }, body: bodyObj === undefined ? undefined : JSON.stringify(bodyObj) });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, body: j };
  };
  return {
    port, base, health, api,
    output: () => out,
    calls: () => { try { return fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } },
    tasks: async () => (await api('GET', '/api/tasks')).body,
    task: async id => (await api('GET', '/api/tasks')).body.find(t => t.id === id),
    async until(id, pred, ms = 15000) {
      const end = Date.now() + ms; let t;
      while (Date.now() < end) { t = (await api('GET', '/api/tasks')).body?.find(x => x.id === id); if (t && pred(t)) return t; await sleep(100); }
      throw new Error(`task ${id} never reached the expected state; last: ${JSON.stringify(t && { state: t.state, error: t.error, lastError: t.lastError })}\n${out.slice(-1500)}`);
    },
    async stop() { if (p.exitCode === null) { p.kill(); await exited; } },
  };
}

/** A raw request with a chosen Host header (fetch will not let a test set one). */
export function rawRequest(port, { method = 'GET', pathname = '/api/health', headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers }, res => { let s = ''; res.on('data', d => { s += d; }); res.on('end', () => resolve({ status: res.statusCode, body: s })); });
    req.on('error', reject); req.end();
  });
}
