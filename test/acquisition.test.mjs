// Phase 6 of the reliability handoff: one fixture prospect goes through the whole first-client
// workflow — research, qualify, draft, review, approve, send, follow up, propose, sign, hand to
// delivery — with no duplicate outreach and no invented facts. The prospects are fixtures: nothing
// here touches the network or a real inbox.   npm test
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch, startOffice, sleep } from './helpers.mjs';
import * as acq from '../acquisition.mjs';

const FIXTURE = [
  { company: 'Fixture Advisory', domain: 'www.fixture-advisory.example.com', country: 'UK', contact: { name: 'Pat Fixture', role: 'Founder', email: 'pat@fixture-advisory.example.com' },
    source: { url: 'https://fixture-advisory.example.com/about', retrievedAt: '2026-09-17', publishedAt: null },
    fitEvidence: [{ claim: '12-person strategy consultancy, founder-led', url: 'https://fixture-advisory.example.com/team' }], trigger: 'hired two consultants in August' },
  { company: 'No Source Ltd', domain: 'nosource.example.com', source: { url: '' }, fitEvidence: [{ claim: 'sounds like a fit', url: '' }] },
  { company: 'Fixture Advisory (again)', domain: 'fixture-advisory.example.com', source: { url: 'https://fixture-advisory.example.com' }, fitEvidence: [{ claim: 'duplicate', url: 'https://fixture-advisory.example.com' }] },
];
const LIMITS = { active: true, outreachPerDayMax: 2, followUpDays: 0, maxFollowUps: 1, spendCeiling: 0, deadline: null };

describe('acquisition rules', () => {
  test('research without a source URL is rejected, duplicates and opted-out prospects never re-enter', () => {
    const pipe = { prospects: [], runs: [] };
    const r = acq.acceptResearch(pipe, FIXTURE, { taskId: 't' });
    assert.equal(r.accepted.length, 1); assert.equal(r.accepted[0].key, 'fixture-advisory.example.com');
    assert.deepEqual(r.rejected.map(x => x.why.split(' ')[0]), ['no', 'already']);
    acq.mark(pipe, 'fixture-advisory.example.com', 'opted-out', 'asked by email');
    const again = acq.acceptResearch(pipe, [FIXTURE[0]], { taskId: 't2' });
    assert.equal(again.accepted.length, 0); assert.match(again.rejected[0].why, /asked not to be contacted/);
  });
  test('a yes without reasons, or with missing evidence, goes to the owner — never a score', () => {
    const pipe = { prospects: [], runs: [] }; acq.acceptResearch(pipe, [FIXTURE[0]], {});
    acq.applyQualification(pipe, [{ key: 'fixture-advisory.example.com', fit: 'yes', reasons: [], missing: [] }]);
    assert.equal(pipe.prospects[0].stage, 'needs-review');
  });
  test('the workflow is off, and says exactly what is missing, until the owner sets the limits', () => {
    const p = acq.plan({ prospects: [] }, { active: false, missing: ['outreachPerDayMax', 'spendCeiling'], config: {}, file: 'acquisition.json' }, []);
    assert.equal(p.actions.length, 0); assert.match(p.noop, /outreachPerDayMax.*spendCeiling.*not set/);
  });
  test('won needs a sent proposal and the owner saying what was signed', () => {
    const pipe = { prospects: [], runs: [] }; acq.acceptResearch(pipe, [FIXTURE[0]], {});
    assert.match(acq.mark(pipe, 'fixture-advisory.example.com', 'signed', 'yes').error, /sent proposal/);
  });
});

describe('the first-client workflow, end to end, on a fixture prospect', () => {
  let s, office, fixtureFile;
  const pipeline = async () => (await office.api('GET', '/api/pipeline')).body;
  const prospect = async () => (await pipeline()).prospects.find(p => p.key === 'fixture-advisory.example.com');
  const untilStage = async (stage, ms = 20000) => { const end = Date.now() + ms; let p; while (Date.now() < end) { p = await prospect(); if (p?.stage === stage) return p; await sleep(150); } throw new Error(`never reached ${stage}; at ${p?.stage}: ${JSON.stringify(p?.history?.at(-1))}\n${office.output().slice(-1200)}`); };
  const taskFor = async (step, state) => { const end = Date.now() + 20000; while (Date.now() < end) { const t = (await office.tasks()).filter(x => x.pipeline?.step === step && (!state || x.state === state)).at(-1); if (t) return t; await sleep(150); } throw new Error(`no ${step} task${state ? ' in ' + state : ''}`); };
  const sends = () => office.calls().filter(c => c.mode === 'SEND').length;

  before(async () => {
    s = scratch('acq');
    fixtureFile = path.join(s.dir, 'prospects.json'); fs.writeFileSync(fixtureFile, JSON.stringify(FIXTURE));
    office = await startOffice({ brain: s.brain, data: s.data, env: { FAKE_PROSPECTS: fixtureFile } });
  });
  after(async () => { await office.stop(); s.cleanup(); });

  test('before the owner sets the limits: an actionable no-op, no work, and a pending decision', async () => {
    const file = path.join(s.brain, 'Agents Office', 'acquisition.json');
    assert.ok(fs.existsSync(file), 'the limits file is written with every value unset');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).outreachPerDayMax, null);
    const r = (await office.api('POST', '/api/pipeline/advance')).body;
    assert.equal(r.created.length, 0); assert.match(r.noop, /not set/);
    const pend = (await office.api('GET', '/api/pending')).body;
    assert.ok(pend.items.some(i => i.kind === 'acquisition-constraints'));
  });

  test('research → qualify → draft → review: one cited prospect reaches the owner as one draft', async () => {
    fs.writeFileSync(path.join(s.brain, 'Agents Office', 'acquisition.json'), JSON.stringify(LIMITS));
    const r = (await office.api('POST', '/api/pipeline/advance')).body;
    assert.deepEqual(r.created.map(c => c.step), ['research']);
    const p = await untilStage('drafted');
    assert.equal(p.company, 'Fixture Advisory'); assert.equal(p.fitEvidence[0].url, 'https://fixture-advisory.example.com/team');
    const pipe = await pipeline();
    assert.equal(pipe.prospects.length, 1, 'no source and duplicate were rejected');
    assert.ok(pipe.runs.some(x => x.step === 'research' && x.rejected.length === 2));
    const draft = await taskFor('draft', 'waiting');
    assert.equal(draft.agent, 'pros'); assert.equal(draft.review.agent, 'qa');
    assert.equal(sends(), 0, 'nothing is sent before the owner approves');
  });

  test('advancing again creates no second draft for the same prospect', async () => {
    const before = (await office.tasks()).filter(t => t.pipeline?.step === 'draft').length;
    for (let i = 0; i < 3; i++) await office.api('POST', '/api/pipeline/advance');
    assert.equal((await office.tasks()).filter(t => t.pipeline?.step === 'draft').length, before);
  });

  test('approve → sent once, the remote reference is logged, the REASON line is not sent', async () => {
    const draft = await taskFor('draft', 'waiting');
    await office.api('POST', `/api/tasks/${draft.id}/approve`, { waitingAt: draft.waitingAt });
    const p = await untilStage('contacted');
    const o = p.outreach.find(x => x.taskId === draft.id);
    assert.equal(o.status, 'sent'); assert.match(o.remoteRef, /^fake-msg-/);
    assert.equal(sends(), 1);
    assert.equal(office.calls().filter(c => c.mode === 'approve').at(-1).controlLinesInSend, false);
  });

  test('follow-up on the owner\'s cadence, up to the owner\'s limit, then it stops', async () => {
    const f = await taskFor('followup', 'waiting');
    assert.equal(f.agent, 'folo');
    await office.api('POST', `/api/tasks/${f.id}/approve`, { waitingAt: f.waitingAt });
    const end = Date.now() + 15000; let p;
    while (Date.now() < end) { p = await prospect(); if (p.followUps === 1) break; await sleep(150); }
    assert.equal(p.followUps, 1); assert.equal(sends(), 2);
    for (let i = 0; i < 3; i++) await office.api('POST', '/api/pipeline/advance');
    await sleep(500);
    assert.equal((await office.tasks()).filter(t => t.pipeline?.step === 'followup').length, 1, 'maxFollowUps 1: no second follow-up');
    const pipe = await pipeline();
    assert.equal(pipe.runs.filter(r => r.taskId === f.id && r.state === 'done').length, 1, 'a finished task is applied to the pipeline once');
  });

  test('interested → proposal draft → approved → sent; signed → won and handed to delivery', async () => {
    assert.equal((await office.api('POST', '/api/pipeline/fixture-advisory.example.com/mark', { event: 'signed', note: 'too early' })).status, 400, 'no signing before a proposal');
    const m = await office.api('POST', '/api/pipeline/fixture-advisory.example.com/mark', { event: 'interested', note: 'asked for pricing on the Growth retainer' });
    assert.equal(m.status, 200); assert.equal(m.body.task.agent, 'piper');
    const prop = await taskFor('proposal', 'waiting');
    await office.api('POST', `/api/tasks/${prop.id}/approve`, { waitingAt: prop.waitingAt });
    await untilStage('proposal-sent');
    const w = await office.api('POST', '/api/pipeline/fixture-advisory.example.com/mark', { event: 'signed', note: 'Growth retainer, signed PDF in Drive' });
    assert.equal(w.status, 200); assert.equal(w.body.prospect.stage, 'won'); assert.equal(w.body.task.agent, 'dlead');
    const plan = await office.until(w.body.task.id, t => t.state === 'done');
    assert.equal(plan.needsOk, false, 'a delivery plan contacts no one');
    const final = await prospect();
    assert.equal(final.deliveryPlan.taskId, plan.id);
    assert.equal(sends(), 3, 'first touch, one follow-up, one proposal — nothing else went out');
    assert.deepEqual([...new Set(final.history.map(h => h.stage))], ['researched', 'qualified', 'drafted', 'contacted', 'interested', 'proposal-drafted', 'proposal-sent', 'won']);
  });

  test('an opted-out prospect is never drafted again', async () => {
    await office.api('POST', '/api/pipeline/fixture-advisory.example.com/mark', { event: 'opted-out', note: 'unsubscribe' });
    const before = (await office.tasks()).filter(t => t.pipeline?.key === 'fixture-advisory.example.com').length;
    await office.api('POST', '/api/pipeline/advance');
    await sleep(800);
    assert.equal((await office.tasks()).filter(t => t.pipeline?.key === 'fixture-advisory.example.com').length, before);
  });
});

describe('zero eligible prospects', () => {
  test('an empty research result is a visible no-op, not an approval request', async () => {
    const s = scratch('acq-empty');
    const empty = path.join(s.dir, 'none.json'); fs.writeFileSync(empty, '[]');
    fs.writeFileSync(path.join(s.brain, 'Agents Office', 'acquisition.json'), JSON.stringify(LIMITS));
    const office = await startOffice({ brain: s.brain, data: s.data, env: { FAKE_PROSPECTS: empty } });
    try {
      const r = (await office.api('POST', '/api/pipeline/advance')).body;
      await office.until(r.created[0].id, t => t.state === 'done');
      await sleep(500);
      const pipe = (await office.api('GET', '/api/pipeline')).body;
      assert.match(pipe.runs.at(-1).noop, /no new eligible prospect/);
      assert.ok(!(await office.tasks()).some(t => t.state === 'waiting'), 'no approval request for nothing');
    } finally { await office.stop(); s.cleanup(); }
  });
});
