// Phase 5 of the reliability handoff: one research service, cited findings, stale and unsupported
// ones stopped, policy edits blocked, findings reaching only their roles, owner-published rules that
// roll back, and a budget the scheduler respects.   npm test
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch, startOffice, sleep } from './helpers.mjs';
import * as research from '../research.mjs';

const day = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const GOOD = { claim: 'Gmail requires bulk senders to offer one-click unsubscribe', kind: 'fact', sourceUrl: 'https://support.google.com/mail/answer/81126', publisher: 'Google', firstParty: true, publishedAt: day(20), retrievedAt: day(0), corroboratedBy: [], affectedRoles: ['pros', 'folo'], confidence: 'high', proposedAction: 'Add a one-line way to opt out to every first touch' };
const FINDINGS = [
  GOOD,
  { claim: 'Cold email reply rates doubled this year', kind: 'interpretation', sourceUrl: 'https://blog.example.com/cold-email', publisher: 'Some Blog', firstParty: false, publishedAt: day(10), retrievedAt: day(0), corroboratedBy: [], affectedRoles: ['pros'], confidence: 'medium', proposedAction: 'Send three times as many emails' },
  { claim: 'LinkedIn limited connection requests', kind: 'fact', sourceUrl: 'https://www.linkedin.com/help/old', publisher: 'LinkedIn', firstParty: true, publishedAt: day(1100), retrievedAt: day(0), corroboratedBy: [], affectedRoles: ['pros'], confidence: 'high', proposedAction: '' },
  { claim: 'Agencies like ours charge $9,000 a month', kind: 'fact', sourceUrl: 'https://survey.example.org/2026', publisher: 'Agency Survey', firstParty: false, publishedAt: day(15), retrievedAt: day(0), corroboratedBy: ['https://other.example.org/rates'], affectedRoles: ['piper'], confidence: 'medium', proposedAction: 'Raise the Growth retainer price to $9,000' },
  { claim: 'A claim with no page', kind: 'fact', sourceUrl: '', publisher: 'Nobody', publishedAt: day(5), retrievedAt: day(0), affectedRoles: ['pros'] },
  { ...GOOD },
  { ...GOOD, claim: 'A finding for a role that does not exist', affectedRoles: ['nobody'] },
];

describe('research rules', () => {
  test('protected subjects are recognised', () => {
    assert.ok(research.PROTECTED.test('raise the Growth retainer price'));
    assert.ok(research.PROTECTED.test('skip owner approval for small sends'));
    assert.ok(!research.PROTECTED.test('add a one-line opt-out to every first touch'));
  });
});

describe('the research service in a running office', () => {
  let s, office, file;
  const cfgFile = () => path.join(s.brain, 'Agents Office', 'research.json');
  const stats = async () => (await office.api('GET', '/api/research')).body;
  before(async () => {
    s = scratch('research');
    file = path.join(s.dir, 'findings.json'); fs.writeFileSync(file, JSON.stringify(FINDINGS));
    office = await startOffice({ brain: s.brain, data: s.data, env: { FAKE_FINDINGS: file, FAKE_PROBE: GOOD.claim } });
  });
  after(async () => { await office.stop(); s.cleanup(); });

  test('research does not run until the owner sets its budget', async () => {
    assert.ok(fs.existsSync(cfgFile()));
    assert.equal(JSON.parse(fs.readFileSync(cfgFile(), 'utf8')).runsPerWeek, null);
    const r = await office.api('POST', '/api/research/run');
    assert.equal(r.status, 409); assert.match(r.body.error, /runsPerWeek/);
  });

  test('a run keeps the cited finding, rejects the unsupported and uncited, flags the stale, blocks the price change', async () => {
    const c = JSON.parse(fs.readFileSync(cfgFile(), 'utf8'));
    fs.writeFileSync(cfgFile(), JSON.stringify({ ...c, active: true, runsPerWeek: 1, findingsPerRun: 5 }));
    const r = await office.api('POST', '/api/research/run');
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.task.agent, 'scout');
    await office.until(r.body.task.id, t => t.state === 'done');
    await sleep(300);
    const st = await stats();
    assert.equal(st.accepted, 1); assert.equal(st.stale, 1); assert.equal(st.blocked, 1);
    assert.equal(st.rejected, 3);
    assert.ok(st.rejectedWhy.some(x => x.why === 'unsupported'));
    assert.equal(st.runs.at(-1).duplicates, 1);
    const pend = (await office.api('GET', '/api/pending')).body;
    assert.ok(pend.items.some(i => i.kind === 'research-blocked' && /price/.test(i.decision)));
  });

  test('the scheduler and manual runs respect the weekly budget', async () => {
    const r = await office.api('POST', '/api/research/run');
    assert.equal(r.status, 429); assert.match(r.body.error, /budget is spent/);
  });

  test('a dated finding reaches the roles it names, and no other', async () => {
    const t = (await office.api('POST', '/api/tasks', { dept: 'sales', text: 'list the openers' })).body;
    await office.api('POST', `/api/tasks/${t.id}/reassign`, { agent: 'pros' });
    await office.api('POST', `/api/tasks/${t.id}/run`);
    const other = (await office.api('POST', '/api/tasks', { dept: 'sales', text: 'list the lead sizes' })).body; // lexi
    await office.api('POST', `/api/tasks/${other.id}/run`);
    const calls = office.calls().filter(c => c.mode === 'readonly');
    assert.equal(calls.find(c => c.request === 'list the openers').probe, true, 'PROSPECTOR got the finding');
    assert.equal(calls.find(c => c.request === 'list the lead sizes').probe, false, 'SALES LEAD did not');
  });

  test('only the owner publishes a rule, never a blocked one, and it rolls back', async () => {
    const st = (await office.api('GET', '/api/research')).body;
    const good = st.findings.find(f => f.status === 'accepted'), blocked = st.findings.find(f => f.status === 'blocked');
    assert.equal((await office.api('POST', `/api/research/findings/${blocked.key}/publish`, { skill: 'proposal', rule: 'Quote $9,000', approvedBy: 'owner' })).status, 409);
    assert.equal((await office.api('POST', `/api/research/findings/${good.key}/publish`, { skill: 'client-acquisition', rule: 'End every first touch with a one-line way to opt out.' })).status, 403);
    const p = await office.api('POST', `/api/research/findings/${good.key}/publish`, { skill: 'client-acquisition', rule: 'End every first touch with a one-line way to opt out.', approvedBy: 'owner' });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    const brainSkill = path.join(s.brain, 'Agents Office', 'skills', 'client-acquisition', 'SKILL.md');
    assert.match(fs.readFileSync(brainSkill, 'utf8'), /one-line way to opt out\. \(from research: Google/);
    const skills = (await office.api('GET', '/api/skills')).body.skills;
    assert.equal(skills.find(x => x.name === 'client-acquisition').source, 'brain');
    const rb = await office.api('POST', '/api/research/rollback', { skill: 'client-acquisition', why: 'replies dropped' });
    assert.equal(rb.status, 200);
    assert.ok(!fs.existsSync(brainSkill), 'the shipped skill is back in use');
    assert.equal((await office.api('GET', '/api/skills')).body.skills.find(x => x.name === 'client-acquisition').source, 'shipped');
    const after = await stats();
    assert.equal(after.rolledBack, 1); assert.equal(after.accepted, 1);
  });
});

describe('a failed research run', () => {
  for (const [mode, expect] of [['ERROR', /failed.*web search tool unavailable/], ['NOBLOCK', /no readable findings block/]]) {
    test(`${mode === 'ERROR' ? 'an unavailable tool' : 'an unreadable result'} is a visible gap, not a digest`, async () => {
      const s = scratch('research-gap');
      fs.writeFileSync(path.join(s.brain, 'Agents Office', 'research.json'), JSON.stringify({ ...research.template(), active: true, runsPerWeek: 2, findingsPerRun: 5 }));
      const office = await startOffice({ brain: s.brain, data: s.data, env: { FAKE_FINDINGS: mode } });
      try {
        const r = (await office.api('POST', '/api/research/run')).body;
        await office.until(r.task.id, t => t.state === 'done');
        await sleep(300);
        const st = (await office.api('GET', '/api/research')).body;
        assert.equal(st.findings.length, 0);
        assert.match(st.gaps.at(-1).gap, expect);
        assert.ok((await office.api('GET', '/api/pending')).body.items.some(i => i.kind === 'research-gap'));
      } finally { await office.stop(); s.cleanup(); }
    });
  }
});
