// The last items of the handoff's test matrix: the approval names its recipient, an agent gets only
// the connectors wired to its department, read-only work retries network failures with backoff (and
// nothing else retries), notes that contradict the price list are surfaced, and corrections become
// rules only by repetition or the owner.   npm test
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch, startOffice, sleep } from './helpers.mjs';

describe('execution and knowledge edges', () => {
  test('a configured Claude path that does not exist is a clear spawn failure, never another binary', async () => {
    const s = scratch('nobin');
    const office = await startOffice({ brain: s.brain, data: s.data, env: { AO_CLAUDE: path.join(s.dir, 'no-such-claude.exe') } });
    try {
      const t = (await office.api('POST', '/api/tasks', { dept: 'sales', agent: 'lexi', text: 'list the leads', needsOk: false })).body;
      const r = (await office.api('POST', `/api/tasks/${t.id}/run`)).body;
      assert.equal(r.error, true); assert.match(r.result, /not found at the configured path/);
      assert.equal(r.attempts[0].cause, 'spawn');
      assert.ok((await office.api('GET', '/api/ops')).body.problems.some(p => p.kind === 'spawn'));
    } finally { await office.stop(); s.cleanup(); }
  });

  test('a core note over its budget is cut with an explicit omission, and its effective date is recorded', async () => {
    const s = scratch('budget');
    fs.writeFileSync(path.join(s.brain, '10-Business', 'offer-ladder.md'), '# Offer ladder\nApproved by the owner, 16 Sep 2026.\n' + 'A long line about the fixture offer, repeated.\n'.repeat(300));
    const office = await startOffice({ brain: s.brain, data: s.data, env: { FAKE_PROBE: '[CUT: the rest of offer-ladder.md' } });
    try {
      const t = (await office.api('POST', '/api/tasks', { dept: 'sales', agent: 'lexi', text: 'list the budget leads', needsOk: false })).body;
      const r = (await office.api('POST', `/api/tasks/${t.id}/run`)).body;
      assert.equal(office.calls().find(c => c.request === 'list the budget leads').probe, true, 'the cut is named in the prompt');
      assert.equal(r.sources.find(x => x.note === 'offer-ladder').effective, '2026-09-16');
    } finally { await office.stop(); s.cleanup(); }
  });
});

describe('authority and resilience', () => {
  let s, office;
  before(async () => {
    s = scratch('leftovers');
    fs.writeFileSync(path.join(s.brain, '10-Business', 'old-pricing-draft.md'), '# Pricing draft\nThe Growth retainer is $4,000 a month.\n');
    office = await startOffice({ brain: s.brain, data: s.data, env: { AO_RETRY_BASE_MS: '200' } });
    await sleep(500); // connector discovery (the fake answers at once)
  });
  after(async () => { await office.stop(); s.cleanup(); });

  test('an approval records the recipient, and the send is told to use only that recipient', async () => {
    const t = (await office.api('POST', '/api/tasks', { dept: 'sales', text: 'send the recipient email' })).body;
    const w = (await office.api('POST', `/api/tasks/${t.id}/run`)).body;
    // the fake's draft has no TO line: give it one, as a real draft would, and re-hash it the way the office does
    const file = path.join(s.data, 'tasks.json'); const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    const rec = list.find(x => x.id === t.id); rec.draft = 'TO: Pat Fixture <pat@fixture-advisory.example.com>\n' + rec.draft;
    const crypto = await import('node:crypto'); rec.draftHash = crypto.createHash('sha256').update(rec.draft).digest('hex').slice(0, 16);
    fs.writeFileSync(file, JSON.stringify(list));
    assert.equal((await office.api('POST', `/api/tasks/${t.id}/approve`, { waitingAt: w.waitingAt })).status, 200);
    const done = await office.until(t.id, x => x.state === 'done');
    assert.equal(done.approval.recipient, 'Pat Fixture <pat@fixture-advisory.example.com>');
  });

  test('an agent gets only the connectors wired to its department', async () => {
    const t = (await office.api('POST', '/api/tasks', { dept: 'sales', text: 'list the wired tools' })).body;
    await office.api('POST', `/api/tasks/${t.id}/run`);
    const m = (await office.api('POST', '/api/tasks', { dept: 'marketing', text: 'list the marketing tools' })).body;
    await office.api('POST', `/api/tasks/${m.id}/run`);
    const calls = office.calls();
    const sales = calls.find(c => c.request === 'list the wired tools').allowed, marketing = calls.find(c => c.request === 'list the marketing tools').allowed;
    assert.match(sales, /mcp__claude_ai_Gmail/); assert.doesNotMatch(sales, /Canva/);
    assert.match(marketing, /mcp__claude_ai_Canva/); assert.doesNotMatch(marketing, /Gmail/);
  });

  test('read-only server work retries a network failure with backoff, then stops; a login failure never retries', async () => {
    const up = (await office.api('POST', '/api/tasks', { dept: 'sales', text: 'list the base' })).body;
    await office.api('POST', `/api/tasks/${up.id}/run`);
    const net = (await office.api('POST', `/api/tasks/${up.id}/handoff`, { agent: 'enzo', text: 'list the offline leads [fake:offline]', needsOk: false })).body;
    const failed = await office.until(net.id, t => t.state === 'done' && t.error, 20000);
    assert.equal(failed.attempts.length, 3);
    assert.deepEqual(failed.attempts.map(a => a.cause), ['network', 'network', 'network']);
    assert.ok(failed.history.some(h => /retry 1 of 2/.test(h.why || '')));
    const login = (await office.api('POST', `/api/tasks/${up.id}/handoff`, { agent: 'enzo', text: 'list the login leads [fake:login]', needsOk: false })).body;
    const lf = await office.until(login.id, t => t.state === 'done' && t.error);
    assert.equal(lf.attempts.length, 1, 'a login problem needs the owner, not a retry');
  });

  test('a note that quotes an offer off the price list is surfaced', async () => {
    const o = (await office.api('GET', '/api/ops')).body;
    const c = o.problems.find(p => p.kind === 'price-conflict');
    assert.ok(c && c.note === 'old-pricing-draft' && /4,000/.test(c.text), JSON.stringify(o.problems));
  });

  test('a proposed rule reaches the owner; only the owner confirms it', async () => {
    const learn = await import('../learn.mjs');
    learn.record(s.brain, { id: 'piper', name: 'PROPOSALS' }, { title: 'x' }, 'keep it to one page', { standing: true, rule: 'Keep every proposal to one page.' });
    const pend = (await office.api('GET', '/api/pending')).body;
    assert.ok(pend.items.some(i => i.kind === 'proposed-rule' && i.agent === 'piper' && /one page/.test(i.decision)));
    assert.equal((await office.api('POST', '/api/lessons/piper/confirm', { index: 0 })).status, 403);
    const ok = await office.api('POST', '/api/lessons/piper/confirm', { index: 0, approvedBy: 'owner' });
    assert.equal(ok.status, 200); assert.equal(ok.body.lessons.rules.length, 1);
  });
});
