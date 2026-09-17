// Phase 3 of the reliability handoff: the right notes reach a task, stale and fake ones do not, and
// every result records which version of which note it was built on.   npm test
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch, startOffice, hash } from './helpers.mjs';

describe('knowledge reaching a task', () => {
  let s, office;
  before(async () => {
    s = scratch('knowledge');
    const put = (rel, text) => { const p = path.join(s.brain, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
    put('Agents Office/Clients/Zephyrco/zephyrco-brief.md', '# Zephyrco brief\nA live client record. Kickoff notes for the retainer.\n');
    put('Agents Office/Clients/_archive/oldhollow-brief.md', '# Oldhollow brief\nAn archived client. Kickoff notes for the retainer.\n');
    put('Agents Office/Clients/sample-client/samplecorp-brief.md', '# Samplecorp brief\nA sample client. Kickoff notes for the retainer.\n');
    put('30-Customers/icp-draft.md', '---\nstatus: superseded\n---\n# ICP draft\nKickoff notes for the retainer: an old guess at the buyer.\n');
    put('Agents Office/2026-09-01 old-kickoff-plan.md', '---\nagent: X\n---\n# Old kickoff plan\n\n> **SUPERSEDED, 2 Sep 2026 — do not act on this.**\n\nKickoff notes for the retainer.\n');
    put('Agents Office/Clients/Quillon/quillon-profile.md', '# Quillon profile\nA second live client record.\n');
    put('30-Customers/kickoff-checklist.md', '# Kickoff checklist\nKickoff notes for the retainer: the current checklist.\n');
    office = await startOffice({ brain: s.brain, data: s.data });
  });
  after(async () => { await office.stop(); s.cleanup(); });

  const runTask = async text => {
    const t = (await office.api('POST', '/api/tasks', { dept: 'sales', text })).body;
    return (await office.api('POST', `/api/tasks/${t.id}/run`)).body;
  };

  test('a client record reaches a task that names the client', async () => {
    const r = await runTask('list the zephyrco kickoff notes for the retainer');
    assert.ok(r.read.includes('zephyrco-brief'), r.read.join());
  });

  test('archived and sample clients never reach a task, even when named', async () => {
    const r = await runTask('list the oldhollow and samplecorp kickoff notes for the retainer');
    assert.ok(!r.read.includes('oldhollow-brief') && !r.read.includes('samplecorp-brief'), r.read.join());
  });

  test("a client record does not reach a task that merely shares words with it", async () => {
    const r = await runTask('list the kickoff notes for the retainer');
    assert.ok(!r.read.includes('zephyrco-brief'), r.read.join());
    assert.ok(r.read.includes('kickoff-checklist'), 'the current note still wins: ' + r.read.join());
  });

  test('superseded notes lose to current ones — by front matter or by banner', async () => {
    const r = await runTask('list the icp draft and the old kickoff plan notes for the retainer');
    assert.ok(!r.read.includes('icp-draft'), r.read.join());
    assert.ok(!r.read.includes('2026-09-01 old-kickoff-plan'), r.read.join());
  });

  test('every result records which version of which note it used', async () => {
    const r = await runTask('list the quillon profile');
    const ladder = r.sources.find(x => x.note === 'offer-ladder');
    assert.equal(ladder.why, 'core');
    assert.equal(ladder.path, '10-Business/offer-ladder.md');
    assert.equal(ladder.hash, hash(fs.readFileSync(path.join(s.brain, '10-Business', 'offer-ladder.md'), 'utf8')));
    assert.ok(ladder.modified);
    for (const n of r.read) assert.ok(r.sources.some(x => x.note === n && x.why === 'relevant' && x.hash), `${n} is read but has no source record`);
    const client = r.sources.find(x => x.note === 'quillon-profile');
    assert.equal(client.why, 'relevant'); assert.equal(client.path, 'Agents Office/Clients/Quillon/quillon-profile.md');
  });

  test('the agent is told to name a missing fact, not to assume one', async () => {
    const serve = fs.readFileSync(new URL('../serve.mjs', import.meta.url), 'utf8');
    assert.ok(!/make a reasonable assumption/.test(serve));
    assert.match(serve, /never invent a figure, price, client, result or policy/);
  });
});
