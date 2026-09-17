// Phase 8 of the reliability handoff: honest status (expired login, lost network, sleep), one office
// per data folder, a clean stop that persists work in progress, and recovery on the next start.   npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { scratch, startOffice, sleep, ROOT } from './helpers.mjs';
import * as ops from '../ops.mjs';

describe('ops rules', () => {
  test('failures are classified by cause', () => {
    assert.equal(ops.causeOf('Claude reported an error: Invalid API key · Please run /login'), 'login');
    assert.equal(ops.causeOf('claude exited 1: API Error: getaddrinfo ENOTFOUND api.anthropic.com'), 'network');
    assert.equal(ops.causeOf('Claude reported an error: 429 rate_limit_error'), 'rate-limit');
    assert.equal(ops.causeOf('Claude took longer than 300 s — last activity: calling Apollo', 'timeout'), 'timeout');
    assert.equal(ops.causeOf('Claude Code is not installed', 'spawn'), 'spawn');
  });
  test('a sleep and a usage hold are surfaced in plain words', () => {
    const now = Date.now();
    const p = ops.problems({ sleeps: [{ from: now - 3600e3, to: now - 600e3 }], usage: { session: { percent: 91 } }, ceiling: 85, now });
    assert.ok(p.some(x => x.kind === 'sleep' && /ran once, late/.test(x.text)));
    assert.ok(p.some(x => x.kind === 'usage' && /91%/.test(x.text)));
  });
});

describe('honest status in a running office', () => {
  test('an expired login and a lost network show as problems, with what to do', async () => {
    const s = scratch('ops-status');
    const office = await startOffice({ brain: s.brain, data: s.data });
    try {
      for (const m of ['login', 'offline']) {
        const t = (await office.api('POST', '/api/tasks', { dept: 'sales', text: `list the leads [fake:${m}]` })).body;
        await office.api('POST', `/api/tasks/${t.id}/run`);
      }
      const o = (await office.api('GET', '/api/ops')).body;
      const login = o.problems.find(x => x.kind === 'login'), net = o.problems.find(x => x.kind === 'network');
      assert.ok(login && /run `claude` and log in/.test(login.text), JSON.stringify(o.problems));
      assert.ok(net && /offline/.test(net.text));
      assert.ok(o.heartbeat.last, 'the heartbeat runs even with the clock off');
      assert.equal(o.ready.ok, true, JSON.stringify(o.ready.checks.filter(c => !c.ok)));
      assert.equal(o.tasks.failed24h, 2);
      const page = await fetch(office.base + '/ops'); assert.equal(page.status, 200); assert.match(await page.text(), /Office operations/);
    } finally { await office.stop(); s.cleanup(); }
  });
});

describe('one office per data folder', () => {
  test('a second office on the same data refuses to start; a dead one\'s lock is taken over', async () => {
    const s = scratch('ops-lock');
    const a = await startOffice({ brain: s.brain, data: s.data });
    try {
      const port = a.port + 1;
      const b = spawn(process.execPath, ['serve.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(port), AO_DATA: s.data, AO_BRAIN: s.brain, AO_CLAUDE: path.join(ROOT, 'test', 'fake-claude.mjs'), AO_CLOCK: 'off', AO_USAGE: 'off' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = ''; b.stdout.on('data', d => { out += d; }); b.stderr.on('data', d => { out += d; });
      const code = await new Promise(r => b.on('exit', r));
      assert.equal(code, 1); assert.match(out, /already running/);
    } finally { await a.stop(); }
    // a.stop() kills the process without a clean shutdown: its lock stays behind
    assert.ok(fs.existsSync(path.join(s.data, 'office.lock')));
    const c = await startOffice({ brain: s.brain, data: s.data });
    try { assert.match(c.output(), /did not shut down cleanly — taking over/); }
    finally { await c.stop(); s.cleanup(); }
  });
});

describe('stop and start again during a read-only task', () => {
  test('a clean stop ends the run, records it, releases the lock, and the next start finishes the work', async () => {
    const s = scratch('ops-stop');
    const office = await startOffice({ brain: s.brain, data: s.data });
    const t = (await office.api('POST', '/api/tasks', { dept: 'sales', text: 'list the slow leads [fake:wait=2500]' })).body;
    office.api('POST', `/api/tasks/${t.id}/run`).catch(() => {}); // the page would be waiting on this
    await office.until(t.id, x => x.state === 'doing');
    const stop = await office.api('POST', '/api/office/stop');
    assert.equal(stop.body.stopping, true);
    const deadline = Date.now() + 5000; let down = false;
    while (Date.now() < deadline) { try { await fetch(office.base + '/api/health'); } catch { down = true; break; } await sleep(100); }
    assert.ok(down, 'the office stopped');
    await office.stop();
    const saved = JSON.parse(fs.readFileSync(path.join(s.data, 'office.json'), 'utf8'));
    assert.deepEqual(saved.lastShutdown.running, [t.id]);
    assert.ok(!fs.existsSync(path.join(s.data, 'office.lock')), 'a clean stop releases the lock');
    const again = await startOffice({ brain: s.brain, data: s.data });
    try {
      const back = await again.task(t.id);
      assert.equal(back.state, 'next'); assert.equal(back.attempts[0].outcome, 'interrupted');
      const r = await again.api('POST', `/api/tasks/${t.id}/run`);
      assert.equal(r.body.state, 'done'); assert.equal(r.body.error, false);
    } finally { await again.stop(); s.cleanup(); }
  });
});
