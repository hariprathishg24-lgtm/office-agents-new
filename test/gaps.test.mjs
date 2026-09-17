// The gaps the handoff audit named: broken stdin, an API timeout, a port in use, the usage hold, the
// launcher's restart wait, deadlines and budgets, per-role measures, limits on unproven seats, watched
// research pages, whether a published rule helped, and the commercial terms a proposal must state.   npm test
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { scratch, startOffice, sleep, ROOT } from './helpers.mjs';
import { measure } from '../coverage.mjs';
import * as acq from '../acquisition.mjs';
import * as research from '../research.mjs';

const freePort = async () => { const s = http.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; };
const named = (office, text, extra = {}) => office.api('POST', '/api/tasks', { dept: 'sales', agent: 'lexi', text, needsOk: false, ...extra });

describe('execution edges', () => {
  test('a CLI that closes its input at once fails the task, and the office stays up', async () => {
    const s = scratch('nostdin');
    const office = await startOffice({ brain: s.brain, data: s.data, env: { FAKE_NOSTDIN: '1' } });
    try {
      const t = (await named(office, 'list the open deals ' + 'x'.repeat(2_000_000))).body; // bigger than a pipe buffer: the write cannot finish
      const r = await office.api('POST', `/api/tasks/${t.id}/run`);
      assert.equal(r.status, 200); assert.equal(r.body.error, true);
      assert.match(r.body.result, /claude exited 1/);
      assert.equal((await office.api('GET', '/api/health')).status, 200, 'the office is still answering');
    } finally { await office.stop(); s.cleanup(); }
  });

  test('an API call that never answers is a timeout failure, not a hang', async () => {
    const sockets = new Set();
    const slow = http.createServer(() => {}); slow.on('connection', c => sockets.add(c)); // accepts, never answers
    await new Promise(r => slow.listen(0, '127.0.0.1', r));
    const s = scratch('sdk-timeout');
    const office = await startOffice({ brain: s.brain, data: s.data, env: { ANTHROPIC_API_KEY: 'sk-test-not-a-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${slow.address().port}`, AO_TIMEOUT_MS: '800', AO_RETRY_BASE_MS: '50' } });
    try {
      assert.equal(office.health.backend ?? 'anthropic-sdk', 'anthropic-sdk');
      const t = (await named(office, 'list the open deals')).body;
      const r = await office.api('POST', `/api/tasks/${t.id}/run`);
      assert.equal(r.body.error, true, JSON.stringify(r.body));
      assert.ok(r.body.attempts.some(a => a.phase === 'timeout'), JSON.stringify(r.body.attempts));
      assert.match(r.body.result, /took longer than/);
    } finally { await office.stop(); s.cleanup(); for (const c of sockets) c.destroy(); slow.close(); }
  });

  test('a port already in use stops the start with a plain reason', async () => {
    const holder = http.createServer(); await new Promise(r => holder.listen(0, '127.0.0.1', r));
    const s = scratch('port');
    try {
      const env = { ...process.env, PORT: String(holder.address().port), AO_DATA: s.data, AO_BRAIN: s.brain, AO_CLAUDE: path.join(ROOT, 'test', 'fake-claude.mjs'), AO_CLOCK: 'off', AO_USAGE: 'off' };
      delete env.ANTHROPIC_API_KEY; delete env.AO_HOST;
      const p = spawn(process.execPath, ['serve.mjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = ''; p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
      const code = await Promise.race([new Promise(r => p.on('exit', r)), sleep(30000).then(() => { p.kill(); return 'hung'; })]);
      assert.equal(code, 1, out.slice(-800));
      assert.match(out, /already in use/);
    } finally { holder.close(); s.cleanup(); }
  });
});

describe('the usage hold', () => {
  const setup = s => {
    fs.writeFileSync(path.join(s.brain, 'Agents Office', 'routines.json'), JSON.stringify({ routines: [
      { id: 'deal-list', dept: 'sales', agent: 'ilm', title: 'List the open deals', text: 'list the open deals', when: { kind: 'weekdays', at: '08:45' }, needsOk: false, paused: false },
    ] }));
  };
  const due = s => fs.writeFileSync(path.join(s.data, 'routines.json'), JSON.stringify({ 'deal-list': { nextAt: Date.now() - 60000, when: JSON.stringify({ kind: 'weekdays', at: '08:45' }) } }));

  test('over the ceiling a due routine is held and stays due; under it, it fires', async () => {
    const s = scratch('usage-hold'); setup(s); due(s);
    try {
      let office = await startOffice({ brain: s.brain, data: s.data, env: { AO_CLOCK: 'on', AO_USAGE_PERCENT: '100' } });
      try {
        await sleep(2500);
        assert.equal((await office.tasks()).length, 0, 'nothing fired over the ceiling');
        assert.match(office.output(), /routines held/);
      } finally { await office.stop(); }
      office = await startOffice({ brain: s.brain, data: s.data, env: { AO_CLOCK: 'on', AO_USAGE_PERCENT: '1' } });
      try {
        let list = [];
        for (let i = 0; i < 50 && !list.length; i++) { await sleep(200); list = await office.tasks(); }
        assert.equal(list.length, 1, 'the held routine fired once there was headroom');
        assert.equal(list[0].routine, 'deal-list');
      } finally { await office.stop(); }
    } finally { s.cleanup(); }
  });
});

describe('the launcher', { skip: process.platform !== 'win32' && 'start-office.cmd is Windows only' }, () => {
  test('a crashed office is restarted after the wait; a stop on purpose is not restarted', { timeout: 120000 }, async () => {
    const s = scratch('launcher'); const port = await freePort(); const logs = path.join(s.dir, 'logs');
    const env = { ...process.env, PORT: String(port), AO_LOG_DIR: logs, AO_DATA: s.data, AO_BRAIN: s.brain, AO_CLAUDE: path.join(ROOT, 'test', 'fake-claude.mjs'), AO_CLOCK: 'off', AO_USAGE: 'off' };
    delete env.ANTHROPIC_API_KEY; delete env.AO_HOST;
    const launcher = spawn('cmd.exe', ['/d', '/c', path.join(ROOT, 'start-office.cmd')], { cwd: ROOT, env, stdio: 'ignore', windowsHide: true });
    const exited = new Promise(r => launcher.on('exit', r));
    const health = async () => { try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); return r.ok ? await r.json() : null; } catch { return null; } };
    const waitFor = async (pred, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const h = await health(); if (pred(h)) return h; await sleep(250); } return null; };
    let lastPid = null;
    try {
      const first = await waitFor(h => h?.instance?.pid, 45000);
      assert.ok(first, 'the launcher started the office');
      lastPid = first.instance.pid;
      const killedAt = Date.now(); process.kill(first.instance.pid);
      const second = await waitFor(h => h?.instance?.pid && h.instance.pid !== first.instance.pid, 60000);
      assert.ok(second, 'the office came back');
      lastPid = second.instance.pid;
      assert.ok(Date.now() - killedAt >= 14000, `it waited before restarting (${Date.now() - killedAt} ms)`);
      await fetch(`http://127.0.0.1:${port}/api/office/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const code = await Promise.race([exited, sleep(30000).then(() => 'still running')]);
      assert.equal(code, 0, 'the launcher ended after a stop on purpose');
      const log = fs.readFileSync(path.join(logs, 'office.log'), 'utf8');
      assert.match(log, /restarting in 15 s \(restart 1 of 5\)/);
      assert.match(log, /stopped on purpose - not restarting/);
    } finally {
      if (launcher.exitCode === null) spawn('taskkill', ['/pid', String(launcher.pid), '/t', '/f'], { stdio: 'ignore' });
      if (lastPid) { try { process.kill(lastPid); } catch {} }
      await Promise.race([exited, sleep(5000)]); await sleep(500); s.cleanup();
    }
  });
});

describe('deadlines, budgets and limits in a running office', () => {
  let s, office;
  before(async () => { s = scratch('plan'); office = await startOffice({ brain: s.brain, data: s.data, env: { AO_REQUIRE_FOR_OUTBOUND: 'contracted' } }); });
  after(async () => { await office.stop(); s.cleanup(); });
  const pending = async () => (await office.api('GET', '/api/pending')).body.items;

  test('a bad deadline or budget is refused; a passed deadline is surfaced as overdue', async () => {
    assert.equal((await named(office, 'list the deals', { deadline: 'next-ish' })).status, 400);
    assert.equal((await named(office, 'list the deals', { budget: { usd: -1 } })).status, 400);
    const t = (await named(office, 'list the stalled deals', { deadline: Date.now() - 1000 })).body;
    assert.ok(t.deadline);
    assert.ok((await pending()).some(i => i.kind === 'overdue' && i.id === t.id));
    const moved = await office.api('POST', `/api/tasks/${t.id}/plan`, { deadline: Date.now() + 864e5 });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.ok(!(await pending()).some(i => i.kind === 'overdue' && i.id === t.id), 'a moved deadline is no longer overdue');
  });

  test('a task that has spent its budget runs no more until the owner raises it', async () => {
    const t = (await named(office, 'draft the reply to the fixture enquiry', { needsOk: true, budget: { usd: 0.01 } })).body;
    const r = await office.api('POST', `/api/tasks/${t.id}/run`);
    assert.equal(r.body.state, 'waiting'); assert.equal(r.body.attempts.at(-1).costUSD, 0.02, 'the run cost is recorded');
    assert.ok((await pending()).some(i => i.kind === 'budget-spent' && i.id === t.id));
    const again = await office.api('POST', `/api/tasks/${t.id}/reject`, { feedback: 'shorter', waitingAt: r.body.waitingAt });
    assert.equal(again.status, 409); assert.match(again.body.error, /budget/);
    assert.equal((await office.api('POST', `/api/tasks/${t.id}/plan`, { budget: { usd: 1 } })).status, 200);
    assert.ok(!(await pending()).some(i => i.kind === 'budget-spent' && i.id === t.id));
    assert.equal((await office.api('POST', `/api/tasks/${t.id}/reject`, { feedback: 'shorter' })).status, 200);
    await office.until(t.id, x => x.state === 'waiting' && x.attempts.length === 2);
  });

  test('cost and corrections are measured per seat', async () => {
    const cov = (await office.api('GET', '/api/coverage')).body;
    const m = cov.list.find(r => r.id === 'lexi').measures;
    assert.ok(m.costUSD >= 0.04, JSON.stringify(m)); assert.equal(m.costMeasured, true);
    assert.equal(m.corrections, 1, 'the send-back counts as a correction');
  });

  test('an unproven seat cannot send without the owner overriding, and the override is recorded', async () => {
    assert.equal(office.health.readiness.requireForOutbound, 'contracted');
    const t = (await office.api('POST', '/api/tasks', { dept: 'sales', text: 'send an email to the fixture prospect' })).body;
    const d = (await office.api('POST', `/api/tasks/${t.id}/run`)).body;
    assert.equal(d.state, 'waiting');
    const item = (await pending()).find(i => i.kind === 'approval' && i.id === t.id);
    assert.ok(item?.limited, 'the approval is marked limited');
    const refused = await office.api('POST', `/api/tasks/${t.id}/approve`, { waitingAt: d.waitingAt });
    assert.equal(refused.status, 409); assert.match(refused.body.error, /Nothing was sent/); assert.equal(refused.body.limited, true, 'the page can tell a seat limit from other refusals');
    assert.equal((await office.api('POST', `/api/tasks/${t.id}/approve`, { waitingAt: d.waitingAt, override: { approvedBy: 'owner' } })).status, 409, 'an override needs a reason');
    const ok = await office.api('POST', `/api/tasks/${t.id}/approve`, { waitingAt: d.waitingAt, override: { approvedBy: 'owner', reason: 'I read this one myself' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const done = await office.until(t.id, x => x.state === 'done');
    assert.equal(done.approval.override.reason, 'I read this one myself');
    assert.ok(done.approval.seatLevel);
    assert.equal(office.calls().filter(c => c.mode === 'SEND' && c.request.includes('fixture prospect')).length, 1);
  });
});

describe('a seat reads its own contract', () => {
  test('the contract reaches the agent that has one, and a seat without one still runs', async () => {
    const s = scratch('contract');
    const dir = path.join(s.brain, 'Agents Office', 'contracts'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'lexi.md'), '# SALES LEAD\n## Output\nFirst line VERDICT-MARKER-FOR-THE-TEST, then the list.\n');
    const office = await startOffice({ brain: s.brain, data: s.data, env: { FAKE_PROBE: 'VERDICT-MARKER-FOR-THE-TEST' } });
    try {
      const t = (await named(office, 'list the open deals')).body;
      await office.api('POST', `/api/tasks/${t.id}/run`);
      const mine = office.calls().find(c => c.request === 'list the open deals' && c.mode !== 'router');
      assert.equal(mine.probe, true, 'the seat was given its contract');
      const other = (await office.api('POST', '/api/tasks', { dept: 'sales', agent: 'pros', text: 'list the target firms', needsOk: false })).body;
      const r = await office.api('POST', `/api/tasks/${other.id}/run`);
      assert.equal(r.body.error, false, 'a seat with no contract works as before');
      assert.equal(office.calls().find(c => c.request === 'list the target firms' && c.mode !== 'router').probe, false);
    } finally { await office.stop(); s.cleanup(); }
  });
});

describe('measures and terms', () => {
  test('measure counts finished, failed, nothing-to-send, corrections and cost apart', () => {
    const tasks = [
      { agent: 'a', state: 'done', attempts: [{ action: 'run', costUSD: 0.1 }, { action: 'revise', costUSD: 0.05 }] },
      { agent: 'a', state: 'done', error: true, attempts: [{ action: 'run', costUSD: 0.02 }] },
      { agent: 'a', state: 'done', noop: true, attempts: [{ action: 'run' }] },
      { agent: 'a', state: 'waiting', review: { verdict: 'FAIL' }, attempts: [{ action: 'reject', costUSD: 0.03 }] },
      { agent: 'b', state: 'done', attempts: [{ action: 'run', costUSD: 9 }] },
    ];
    const m = measure(tasks, 'a');
    assert.equal(m.tasks, 4); assert.equal(m.completed, 1); assert.equal(m.failed, 1); assert.equal(m.nothingToSend, 1); assert.equal(m.waiting, 1);
    assert.equal(m.completionRate, 0.5); assert.equal(m.corrections, 2); assert.equal(m.reviewerFails, 1);
    assert.equal(m.costUSD, 0.2); assert.equal(m.costPerCompleted, 0.2);
    assert.equal(measure([], 'a').costMeasured, false);
  });

  test('a proposal states the owner\'s terms verbatim, and names unset ones as not established', () => {
    assert.match(acq.termsText({}), /not established.*never invent/);
    const set = acq.termsText({ paymentTerms: 'monthly in advance, net 7', partnerRates: { website: 'USD 4000 per build' }, partnerMargin: '20%' });
    assert.match(set, /monthly in advance, net 7/); assert.match(set, /USD 4000 per build/); assert.match(set, /20%/);
    const pipe = { prospects: [{ key: 'k1', company: 'Fixture Co', source: { url: 'https://fixture.example', retrievedAt: '2026-09-01' }, fitEvidence: [] }] };
    const spec = acq.taskFor({ step: 'proposal', key: 'k1' }, pipe, { config: { paymentTerms: 'net 14' } });
    assert.equal(spec.agent, 'piper'); assert.match(spec.text, /Payment terms: net 14\./);
    assert.ok('paymentTerms' in acq.CONSTRAINTS && 'partnerRates' in acq.CONSTRAINTS && 'partnerMargin' in acq.CONSTRAINTS);
  });
});

describe('watched research pages and rule effects', () => {
  let s, office, page = 'first version', status = 200, site;
  before(async () => {
    site = http.createServer((req, res) => { res.writeHead(status, { 'content-type': 'text/html' }); res.end(`<html><body><p>${page}</p><script>var t=${Date.now()}</script></body></html>`); });
    await new Promise(r => site.listen(0, '127.0.0.1', r));
    s = scratch('watch');
    fs.writeFileSync(path.join(s.brain, 'Agents Office', 'research.json'), JSON.stringify({ ...research.template(), watch: [{ id: 'fixture-page', url: `http://127.0.0.1:${site.address().port}/rules`, roles: ['pros'], question: 'What changed on the fixture page?' }] }));
    office = await startOffice({ brain: s.brain, data: s.data });
  });
  after(async () => { await office.stop(); s.cleanup(); site.close(); });
  const watch = async () => (await office.api('POST', '/api/research/watch')).body;
  const pending = async () => (await office.api('GET', '/api/pending')).body.items;

  test('a research file written before watched pages existed gains them, and keeps what the owner set', async () => {
    const s2 = scratch('watch-upgrade');
    const file = path.join(s2.brain, 'Agents Office', 'research.json');
    const { watch, watchEveryHours, ...old } = research.template(); // the file as it was written before
    fs.writeFileSync(file, JSON.stringify({ ...old, runsPerWeek: 3, findingsPerRun: 4, staleDays: 42 }));
    const o = await startOffice({ brain: s2.brain, data: s2.data });
    try {
      const after = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.ok(Array.isArray(after.watch) && after.watchEveryHours, 'the watch slots were added');
      assert.equal(after.runsPerWeek, 3); assert.equal(after.staleDays, 42, "the owner's settings are untouched");
    } finally { await o.stop(); s2.cleanup(); }
  });

  test('the first check only records the page; a script change alone is not a change', async () => {
    const r = await watch();
    assert.equal(r.checked, 1); assert.deepEqual(r.changed, []);
    assert.deepEqual((await watch()).changed, [], 'the page text is compared, not the markup');
  });

  test('a change the budget cannot cover is shown to the owner; a fetch failure is a gap', async () => {
    page = 'second version';
    const r = await watch();
    assert.deepEqual(r.changed, ['fixture-page']); assert.deepEqual(r.runs, []);
    assert.ok((await pending()).some(i => i.kind === 'research-watch' && i.key === 'fixture-page'));
    status = 500;
    const f = await watch();
    assert.equal(f.failed[0].id, 'fixture-page');
    assert.ok((await pending()).some(i => i.kind === 'research-gap' && i.key === 'fixture-page'));
    status = 200;
  });

  test('with a budget, a change starts one focused research run', async () => {
    const file = path.join(s.brain, 'Agents Office', 'research.json');
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), active: true, runsPerWeek: 2, findingsPerRun: 3 }));
    page = 'third version';
    const r = await watch();
    assert.equal(r.runs.length, 1, JSON.stringify(r));
    const t = await office.task(r.runs[0]);
    assert.match(t.title, /fixture-page changed/); assert.equal(t.researchFocus, 'fixture-page');
    await office.until(t.id, x => x.state === 'done');
    assert.ok(!(await pending()).some(i => i.key === 'fixture-page'), 'the change was researched and the page is readable again');
  });

  test('a published rule that made its seats\' fixture results worse is flagged for rollback', async () => {
    const at = Date.now() - 2 * 864e5;
    const st = JSON.parse(fs.readFileSync(path.join(s.data, 'research.json'), 'utf8'));
    st.published = [...(st.published || []), { skill: 'fixture-skill', version: 1, rule: 'A fixture rule', at, status: 'published' }];
    fs.writeFileSync(path.join(s.data, 'research.json'), JSON.stringify(st));
    const dir = path.join(s.brain, 'Agents Office', 'fixtures', 'pros'); fs.mkdirSync(dir, { recursive: true });
    const run = (when, passes) => ({ agent: 'pros', at: new Date(when).toISOString(), live: true, results: [true, true, true].map((_, i) => ({ passed: i < passes })) });
    const effect = (rolesOf) => research.ruleEffect(research.loadState(s.data), { brainPath: s.brain, rolesOf }).find(e => e.skill === 'fixture-skill');
    assert.equal(effect(() => ['pros']).verdict, 'not measured');
    fs.writeFileSync(path.join(dir, 'results-before.json'), JSON.stringify(run(at - 3600e3, 3)));
    fs.writeFileSync(path.join(dir, 'results-after.json'), JSON.stringify(run(at + 3600e3, 1)));
    const e = effect(() => ['pros']);
    assert.equal(e.verdict, 'regressed'); assert.equal(e.roles[0].before, 1); assert.ok(Math.abs(e.roles[0].after - 1 / 3) < 1e-9);
    fs.writeFileSync(path.join(dir, 'results-after.json'), JSON.stringify(run(at + 3600e3, 3)));
    assert.equal(effect(() => ['pros']).verdict, 'same');
    fs.writeFileSync(path.join(dir, 'results-before.json'), JSON.stringify(run(at - 3600e3, 2)));
    assert.equal(effect(() => ['pros']).verdict, 'improved');
    // in the office: the skill's seats come from the skills themselves, so a skill every agent uses reaches pros
    const everyone = (await office.api('GET', '/api/skills')).body.skills.find(x => x.everyone);
    assert.ok(everyone, 'a shipped skill every agent uses');
    {
      st.published = [{ skill: everyone.name, version: 1, rule: 'A fixture rule', at, status: 'published' }];
      fs.writeFileSync(path.join(s.data, 'research.json'), JSON.stringify(st));
      fs.writeFileSync(path.join(dir, 'results-after.json'), JSON.stringify(run(at + 3600e3, 0)));
      assert.ok((await pending()).some(i => i.kind === 'rule-regressed' && i.key === everyone.name));
      assert.ok((await office.api('GET', '/api/research')).body.effects.some(x => x.skill === everyone.name && x.verdict === 'regressed'));
    }
  });
});
