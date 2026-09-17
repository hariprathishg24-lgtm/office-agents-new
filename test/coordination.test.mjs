// Phase 7 of the reliability handoff: prerequisites, handoffs, an independent reviewer, owner
// questions, cancel / reassign / reconcile, and a pause that stops everything new.   npm test
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { scratch, startOffice, sleep } from './helpers.mjs';
import * as coord from '../coordinator.mjs';

describe('coordinator rules', () => {
  test('handoff and owner lines are parsed, unknown agents and extras refused', () => {
    const r = coord.parseRequests('Result.\nHANDOFF → enzo: enrich Acme\n- **HANDOFF -> piper: price it**\nHANDOFF → nobody: x\nHANDOFF → qa: a\nHANDOFF → pco: b\nNEEDS OWNER: what budget?', ['enzo', 'piper', 'qa', 'pco']);
    assert.deepEqual(r.handoffs.map(h => h.agent), ['enzo', 'piper', 'qa']);
    assert.equal(r.owner[0], 'what budget?');
    assert.ok(r.refused.some(x => x.startsWith('nobody')) && r.refused.some(x => x.startsWith('pco')));
  });
  test('an unreadable review is not a pass', () => {
    assert.equal(coord.parseVerdict('Looks fine to me').verdict, 'UNCLEAR');
    assert.equal(coord.parseVerdict('VERDICT: **PASS**').verdict, 'PASS');
  });
  test('a failed, cancelled or unknown prerequisite keeps the dependent blocked, with the reason', () => {
    const list = [{ id: 'a', title: 'A', state: 'done', error: true }, { id: 'b', title: 'B', state: 'blocked', after: ['a'] }, { id: 'c', title: 'C', state: 'done' }, { id: 'd', title: 'D', state: 'blocked', after: ['c'] }];
    assert.deepEqual(coord.unblock(list), ['d']);
    assert.equal(list[1].state, 'blocked'); assert.match(list[1].blockedReason, /"A" failed/);
    assert.equal(list[3].state, 'next');
  });
  test('history records every change with its reason', () => {
    const list = [{ id: 'x', state: 'doing', because: 'run (attempt 1)' }];
    coord.stampHistory(list, [{ id: 'x', state: 'next' }], 5);
    assert.deepEqual(list[0].history, [{ at: 5, from: 'next', to: 'doing', why: 'run (attempt 1)' }]);
    assert.equal(list[0].because, undefined);
  });
});

describe('coordination in a running office', () => {
  let s, office;
  before(async () => { s = scratch('coord'); office = await startOffice({ brain: s.brain, data: s.data }); });
  after(async () => { await office.stop(); s.cleanup(); });
  const create = async (text, extra = {}) => { const r = await office.api('POST', '/api/tasks', { dept: 'sales', text, ...extra }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
  const run = async id => (await office.api('POST', `/api/tasks/${id}/run`)).body;
  const sends = () => office.calls().filter(c => c.mode === 'SEND').length;

  test('a downstream task cannot start before its prerequisite, and a failed prerequisite blocks it', async () => {
    const up = await create('list the target firms [fake:error]');
    const down = await create('list the owners of those firms', { after: [up.id] });
    assert.equal(down.state, 'blocked');
    const early = await office.api('POST', `/api/tasks/${down.id}/run`);
    assert.equal(early.status, 409); assert.match(early.body.error, /blocked/);
    assert.equal((await run(up.id)).error, true);
    const still = await office.task(down.id);
    assert.equal(still.state, 'blocked'); assert.match(still.blockedReason, /failed/);
    const pend = (await office.api('GET', '/api/pending')).body;
    assert.ok(pend.items.some(i => i.kind === 'blocked' && i.id === down.id));
    const ok = await create('list the firm sizes');
    const next = await create('list the firm websites', { after: [ok.id] });
    await run(ok.id);
    assert.equal((await office.task(next.id)).state, 'next', 'a finished prerequisite releases the dependent');
  });

  test('an agent hands work on: the next task waits for this one, then runs on the server', async () => {
    const t = await create('list one prospect [fake:handoff:enzo]');
    const done = await run(t.id);
    assert.equal(done.state, 'done');
    const all = await office.tasks();
    const child = all.find(x => x.from === t.id);
    assert.ok(child, 'a handoff task was created');
    assert.equal(child.agent, 'enzo'); assert.equal(child.by, 'handoff'); assert.deepEqual(child.after, [t.id]); assert.equal(child.depth, 1);
    const finished = await office.until(child.id, x => x.state === 'done');
    assert.ok(finished.history.some(h => h.to === 'doing') && finished.history[0].why.startsWith('handed off by'));
  });

  test('handoff lines in an approved draft are never part of what is sent', async () => {
    const t = await create('send the intro email [fake:handoff:folo]');
    const w = await run(t.id);
    assert.equal(w.state, 'waiting'); assert.match(w.draft, /HANDOFF → folo/);
    await office.api('POST', `/api/tasks/${t.id}/approve`, { waitingAt: w.waitingAt });
    await office.until(t.id, x => x.state === 'done');
    const sendCall = office.calls().filter(c => c.mode === 'approve' && c.request.includes('intro email')).at(-1);
    assert.equal(sendCall.controlLinesInSend, false);
    assert.ok((await office.tasks()).some(x => x.from === t.id && x.agent === 'folo'), 'the handoff happens after the send');
  });

  test('the reviewer can fail a draft, which never sends it — the owner still decides', async () => {
    const before = sends();
    const t = await create('send the bold claims email [fake:reviewfail]');
    const w = await run(t.id);
    assert.equal(w.state, 'waiting'); assert.equal(w.review.verdict, 'FAIL'); assert.equal(w.review.agent, 'qa');
    assert.match(w.ask, /FAILED it/);
    assert.ok(w.history.some(h => h.to === 'review'), 'the draft went through review');
    assert.equal(sends(), before, 'a failed review sends nothing');
    const pend = (await office.api('GET', '/api/pending')).body;
    assert.match(pend.items.find(i => i.id === t.id).decision, /FAILED it/);
  });

  test('a question for the owner is surfaced, and the answer restarts the work', async () => {
    const t = await create('list prospects within budget [fake:ask]');
    const done = await run(t.id);
    assert.equal(done.needsOwner[0].text, 'what is the monthly outreach budget?');
    const pend = (await office.api('GET', '/api/pending')).body;
    assert.ok(pend.items.some(i => i.kind === 'question' && /budget/.test(i.decision)));
    const a = await office.api('POST', `/api/tasks/${t.id}/answer`, { text: 'not set yet — plan for zero spend' });
    assert.equal(a.status, 200);
    const follow = await office.until(a.body.follow.id, x => x.state === 'done');
    assert.equal(follow.by, 'answer'); assert.match(follow.text, /not set yet/);
  });

  test('cancel stops a waiting draft for good; reassign keeps the history', async () => {
    const w = await run((await create('send the cancelled email')).id);
    const dep = await create('list follow-ups for the cancelled email', { after: [w.id] });
    assert.equal((await office.api('POST', `/api/tasks/${w.id}/cancel`, { why: 'wrong list' })).status, 200);
    assert.equal((await office.api('POST', `/api/tasks/${w.id}/approve`, {})).status, 409);
    assert.match((await office.task(dep.id)).blockedReason, /was cancelled/);
    const t = await create('list the reassigned leads', { after: [w.id] });
    const r = await office.api('POST', `/api/tasks/${t.id}/reassign`, { agent: 'enzo', why: 'enrichment job' });
    assert.equal(r.status, 200); assert.equal(r.body.task.agent, 'enzo'); assert.equal(r.body.task.reassigned[0].from, 'lexi');
    assert.ok(r.body.task.history.length >= 2);
  });

  test('an unknown outcome is reconciled by the owner, not by a retry', async () => {
    const w = await run((await create('send the flaky reconcile email [fake:sendfail]')).id);
    await office.api('POST', `/api/tasks/${w.id}/approve`, { waitingAt: w.waitingAt });
    await office.until(w.id, x => x.state === 'done' && x.needsCheck);
    const count = sends();
    const back = await office.api('POST', `/api/tasks/${w.id}/checked`, { sent: false, note: 'not in the sent folder' });
    assert.equal(back.body.task.state, 'waiting'); assert.equal(back.body.task.reconciled.sent, false);
    assert.equal(sends(), count, 'checking sends nothing');
  });

  test('pause stops runs and approvals until resumed', async () => {
    const t = await create('list the paused leads');
    const w = await run((await create('send the paused email')).id);
    const p = await office.api('POST', '/api/office/pause', { why: 'reviewing the week' });
    assert.equal(p.body.paused.paused, true);
    assert.equal((await office.api('POST', `/api/tasks/${t.id}/run`)).status, 423);
    assert.equal((await office.api('POST', `/api/tasks/${w.id}/approve`, { waitingAt: w.waitingAt })).status, 423);
    assert.equal((await office.api('GET', '/api/health')).body.paused.why, 'reviewing the week');
    assert.equal((await office.api('GET', '/api/pending')).body.paused.paused, true);
    await office.api('POST', '/api/office/resume');
    assert.equal((await office.api('POST', `/api/tasks/${t.id}/run`)).status, 200);
  });
});
