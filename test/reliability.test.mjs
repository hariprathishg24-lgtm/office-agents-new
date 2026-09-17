// Gate A of the reliability handoff: authority, execution claims, failures, storage and recovery,
// proved against a fake Claude and throwaway state.   npm test
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scratch, startOffice, rawRequest, hash, ROOT } from './helpers.mjs';

const sends = (office, request) => office.calls().filter(c => c.mode === 'SEND' && c.request.includes(request)).length;
async function newTask(office, text) {
  const r = await office.api('POST', '/api/tasks', { dept: 'sales', text });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
async function drafted(office, text) { // a task that sends, run to its waiting draft
  const t = await newTask(office, text);
  assert.equal(t.needsOk, true, 'the router said this sends');
  const r = await office.api('POST', `/api/tasks/${t.id}/run`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.state, 'waiting');
  return r.body;
}

describe('one office, fake Claude', () => {
  let s, office;
  before(async () => { s = scratch('main'); office = await startOffice({ brain: s.brain, data: s.data, env: { FAKE_PROBE: 'PRICE-AT-THE-END' } }); });
  after(async () => { await office.stop(); s.cleanup(); });

  test('a task typed into the bar that sends stops at approval — no send', async () => {
    const t = await drafted(office, 'send an email to the fixture prospect');
    assert.ok(t.draft && t.draftHash === hash(t.draft), 'the draft is hashed');
    assert.equal(sends(office, 'fixture prospect'), 0);
    const draftCall = office.calls().find(c => c.request.includes('fixture prospect') && c.mode !== 'router');
    assert.equal(draftCall.mode, 'draft', 'the agent was told to send nothing');
  });

  test('a read-only task runs read-only, lands done and is filed', async () => {
    const t = await newTask(office, 'list the open deals');
    assert.equal(t.needsOk, false);
    const r = await office.api('POST', `/api/tasks/${t.id}/run`);
    assert.equal(r.body.state, 'done'); assert.equal(r.body.error, false); assert.equal(r.body.filed, 'ok');
    assert.ok(fs.existsSync(path.join(s.brain, 'Agents Office', r.body.note + '.md')));
    assert.equal(office.calls().find(c => c.request === 'list the open deals' && c.mode !== 'router').mode, 'readonly');
  });

  test('the whole price list reaches the agent, including its last line', async () => {
    const call = office.calls().find(c => c.request === 'list the open deals' && c.mode !== 'router');
    assert.equal(call.probe, true, 'PRICE-AT-THE-END was cut from the system prompt');
  });

  test('five concurrent approvals produce exactly one send', async () => {
    const t = await drafted(office, 'send the concurrency email');
    const replies = await Promise.all(Array.from({ length: 5 }, () => office.api('POST', `/api/tasks/${t.id}/approve`, { waitingAt: t.waitingAt })));
    assert.deepEqual(replies.map(r => r.status).sort(), [200, 409, 409, 409, 409]);
    const done = await office.until(t.id, x => x.state === 'done');
    assert.equal(done.approved, true); assert.equal(done.error, false);
    assert.equal(sends(office, 'concurrency email'), 1);
    assert.equal(done.attempts.filter(a => a.action === 'approve').length, 1);
    const again = await office.api('POST', `/api/tasks/${t.id}/approve`, {});
    assert.equal(again.status, 409, 'a sent task cannot be approved twice');
    assert.equal(sends(office, 'concurrency email'), 1);
  });

  test('three concurrent runs produce exactly one Claude run', async () => {
    const t = await newTask(office, 'list the quiet leads [fake:wait=700]');
    const replies = await Promise.all([1, 2, 3].map(() => office.api('POST', `/api/tasks/${t.id}/run`)));
    assert.deepEqual(replies.map(r => r.status).sort(), [200, 409, 409]);
    assert.equal(office.calls().filter(c => c.request.includes('quiet leads') && c.mode !== 'router').length, 1);
  });

  test('an approval is for the draft the owner saw: a rework needs a new tick', async () => {
    const t = await drafted(office, 'send the rework email');
    const rj = await office.api('POST', `/api/tasks/${t.id}/reject`, { feedback: 'shorter' });
    assert.equal(rj.status, 200);
    const reworked = await office.until(t.id, x => x.state === 'waiting' && x.waitingAt !== t.waitingAt);
    const stale = await office.api('POST', `/api/tasks/${t.id}/approve`, { waitingAt: t.waitingAt });
    assert.equal(stale.status, 409, 'approving the old draft must be refused');
    assert.equal(sends(office, 'rework email'), 0);
    const ok = await office.api('POST', `/api/tasks/${t.id}/approve`, { waitingAt: reworked.waitingAt });
    assert.equal(ok.status, 200);
    const done = await office.until(t.id, x => x.state === 'done');
    assert.ok(done.result.startsWith(reworked.draft), 'the reworked draft is what was approved');
    assert.equal(sends(office, 'rework email'), 1);
  });

  test('a draft edited on disk after it was written cannot be approved', async () => {
    const t = await drafted(office, 'send the tampered email');
    const file = path.join(s.data, 'tasks.json');
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    list.find(x => x.id === t.id).draft += '\nP.S. wire the money to account 123';
    fs.writeFileSync(file, JSON.stringify(list, null, 2));
    const r = await office.api('POST', `/api/tasks/${t.id}/approve`, {});
    assert.equal(r.status, 409);
    assert.equal(sends(office, 'tampered email'), 0);
  });

  test('an error result, a nonzero exit and an empty run are failures, not deliverables', async () => {
    for (const [marker, expect] of [['error', /reported an error.*overloaded/], ['exit', /exited 3.*partial output/], ['empty', /without a result/]]) {
      const t = await newTask(office, `list it [fake:${marker}]`);
      const r = await office.api('POST', `/api/tasks/${t.id}/run`);
      assert.equal(r.body.error, true, marker);
      assert.match(r.body.result, expect, marker);
      assert.equal(r.body.note, undefined, `${marker}: a failure is not filed as a note`);
    }
  });

  test('a timeout says what the agent was last doing', async () => {
    const t = await newTask(office, 'list prospects [fake:slow]');
    const r = await office.api('POST', `/api/tasks/${t.id}/run`);
    assert.equal(r.body.error, true);
    assert.match(r.body.result, /took longer than 3 s — last activity: calling apollo/);
    assert.equal(r.body.attempts.at(-1).phase, 'timeout');
  });

  test('a send that dies after calling its tool is OUTCOME UNKNOWN and is never retried', async () => {
    const t = await drafted(office, 'send the flaky email [fake:sendfail]');
    await office.api('POST', `/api/tasks/${t.id}/approve`, { waitingAt: t.waitingAt });
    const done = await office.until(t.id, x => x.state === 'done');
    assert.equal(done.needsCheck, true); assert.equal(done.error, true);
    assert.match(done.result, /OUTCOME UNKNOWN/);
    assert.equal(done.attempts.at(-1).outcome, 'unknown');
    assert.equal((await office.api('POST', `/api/tasks/${t.id}/approve`, {})).status, 409);
    assert.equal((await office.api('POST', `/api/tasks/${t.id}/revise`, { feedback: 'try again' })).status, 409);
    assert.equal(sends(office, 'flaky email'), 1);
  });

  test('a send that dies before any tool call goes back to waiting — nothing went out', async () => {
    const t = await drafted(office, 'send the unauthorised email [fake:prefail]');
    await office.api('POST', `/api/tasks/${t.id}/approve`, { waitingAt: t.waitingAt });
    const back = await office.until(t.id, x => x.state === 'waiting' && x.waitingAt !== t.waitingAt);
    assert.equal(back.attempts.at(-1).outcome, 'not-sent');
    assert.equal(back.approval, undefined, 'the approval is spent');
    assert.match(back.ask, /Nothing went out/);
    assert.equal(sends(office, 'unauthorised email'), 0);
  });

  test('a note that cannot be saved does not turn finished work into failed work', async () => {
    const title = 'file this note';
    for (const d of [0, 1]) fs.mkdirSync(path.join(s.brain, 'Agents Office', `${new Date(Date.now() + d * 864e5).toISOString().slice(0, 10)} file-this-note.md`), { recursive: true }); // a folder where the note file should go
    const t = await newTask(office, title);
    const r = await office.api('POST', `/api/tasks/${t.id}/run`);
    assert.equal(r.body.state, 'done'); assert.equal(r.body.error, false);
    assert.equal(r.body.filed, 'failed'); assert.ok(r.body.noteError);
  });

  test('another website cannot post to the office, and a foreign Host is refused', async () => {
    const cross = await office.api('POST', '/api/tasks', { dept: 'sales', text: 'send everything' }, { origin: 'http://evil.example' });
    assert.equal(cross.status, 403);
    const same = await office.api('POST', '/api/tasks', { dept: 'sales', text: 'list the same-origin deals' }, { origin: office.base });
    assert.equal(same.status, 200);
    const rebind = await rawRequest(office.port, { headers: { host: `evil.example:${office.port}` } });
    assert.equal(rebind.status, 403);
  });

  test('the office listens on this machine only', async () => {
    assert.equal(office.health.host, '127.0.0.1');
    const lan = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal);
    if (!lan) return;
    await assert.rejects(fetch(`http://${lan.address}:${office.port}/api/health`, { signal: AbortSignal.timeout(3000) }));
  });
});

describe('storage', () => {
  test('a damaged task file is kept, reported, and never overwritten with an empty list', async () => {
    const s = scratch('corrupt');
    const file = path.join(s.data, 'tasks.json');
    fs.writeFileSync(file, '[{"id": "half-writ');
    const office = await startOffice({ brain: s.brain, data: s.data });
    try {
      const r = await office.api('GET', '/api/tasks');
      assert.equal(r.status, 500); assert.match(r.body.error, /damaged/);
      assert.equal((await office.api('POST', '/api/tasks', { dept: 'sales', text: 'list anything' })).status, 500);
      assert.equal(fs.readFileSync(file, 'utf8'), '[{"id": "half-writ', 'the damaged file is untouched');
      assert.ok(fs.readdirSync(s.data).some(f => f.startsWith('tasks.json.corrupt-')), 'a copy of the damage is kept');
    } finally { await office.stop(); s.cleanup(); }
  });

  test('a damaged task file falls back to the last good copy', async () => {
    const s = scratch('bak');
    fs.writeFileSync(path.join(s.data, 'tasks.json'), '{broken');
    fs.writeFileSync(path.join(s.data, 'tasks.json.bak'), JSON.stringify([{ id: 'kept', dept: 'sales', agent: 'lexi', title: 'Kept', text: 'kept', state: 'done', result: 'ok', doneAt: 1 }]));
    const office = await startOffice({ brain: s.brain, data: s.data });
    try { assert.deepEqual((await office.tasks()).map(t => t.id), ['kept']); }
    finally { await office.stop(); s.cleanup(); }
  });

  test('writes are atomic: no temp file is left and the previous copy is kept as .bak', async () => {
    const s = scratch('atomic');
    const office = await startOffice({ brain: s.brain, data: s.data });
    try {
      await office.api('POST', '/api/tasks', { dept: 'sales', text: 'list one' });
      await office.api('POST', '/api/tasks', { dept: 'sales', text: 'list two' });
      const files = fs.readdirSync(s.data);
      assert.ok(!files.some(f => f.includes('.tmp-')), files.join());
      assert.equal(JSON.parse(fs.readFileSync(path.join(s.data, 'tasks.json.bak'), 'utf8')).length, 1);
    } finally { await office.stop(); s.cleanup(); }
  });
});

describe('recovery after a restart', () => {
  test('mid-flight work is resumed, handed back or flagged — and nothing is sent again', async () => {
    const s = scratch('recover');
    const base = { dept: 'sales', agent: 'lexi', plan: [], addedAt: 1, startedAt: 2 };
    const seeded = [
      { ...base, id: 'routine1', title: 'List today', text: 'list today', by: 'routine', routine: 'x', when: 'daily', needsOk: false, state: 'doing', attempt: 'a1', attempts: [{ id: 'a1', action: 'run', mode: 'readonly', startedAt: 2 }] },
      { ...base, id: 'queued1', title: 'List queued', text: 'list queued', by: 'routine', routine: 'x', when: 'daily', needsOk: false, state: 'next' },
      { ...base, id: 'presend', title: 'Send A', text: 'send A', by: 'you', needsOk: true, state: 'doing', draft: 'D1', draftHash: hash('D1'), waitingAt: 5, approval: { draft: 'D1', draftHash: hash('D1') }, attempt: 'a2', attempts: [{ id: 'a2', action: 'approve', mode: 'approve', startedAt: 2 }] },
      { ...base, id: 'midsend', title: 'Send B', text: 'send B', by: 'you', needsOk: true, state: 'doing', draft: 'D2', draftHash: hash('D2'), approval: { draft: 'D2', draftHash: hash('D2') }, sendStartedAt: 3, attempt: 'a3', attempts: [{ id: 'a3', action: 'approve', mode: 'approve', startedAt: 2 }] },
      { ...base, id: 'tired', title: 'List C', text: 'list C', by: 'you', needsOk: false, state: 'doing', attempt: 'a6', attempts: [{ id: 'a4', action: 'run' }, { id: 'a5', action: 'run' }, { id: 'a6', action: 'run', mode: 'readonly' }] },
      { ...base, id: 'legacy', title: 'Old draft', text: 'send old', by: 'routine', needsOk: true, state: 'waiting', draft: 'OLD DRAFT', result: 'OLD DRAFT' },
      { ...base, id: 'finished', title: 'Done before', text: 'x', by: 'you', state: 'done', result: 'kept exactly', doneAt: 9 },
    ];
    fs.writeFileSync(path.join(s.data, 'tasks.json'), JSON.stringify(seeded));
    const office = await startOffice({ brain: s.brain, data: s.data });
    try {
      await office.until('routine1', t => t.state === 'done' && !t.error);
      await office.until('queued1', t => t.state === 'done' && !t.error);
      const presend = await office.task('presend');
      assert.equal(presend.state, 'waiting'); assert.match(presend.ask, /Nothing went out/);
      const midsend = await office.task('midsend');
      assert.equal(midsend.state, 'done'); assert.equal(midsend.needsCheck, true); assert.match(midsend.result, /OUTCOME UNKNOWN/);
      const tired = await office.task('tired');
      assert.equal(tired.state, 'done'); assert.equal(tired.error, true);
      const legacy = await office.task('legacy');
      assert.equal(legacy.draftHash, hash('OLD DRAFT'), 'drafts from before this change stay approvable');
      assert.deepEqual(await office.task('finished'), seeded.at(-1), 'finished work is not rewritten');
      assert.equal(office.calls().filter(c => c.mode === 'SEND').length, 0, 'recovery sent nothing');
      assert.equal((await office.api('POST', '/api/tasks/legacy/approve', {})).status, 200);
      await office.until('legacy', t => t.state === 'done');
      assert.equal(office.calls().filter(c => c.mode === 'SEND').length, 1);
    } finally { await office.stop(); s.cleanup(); }
  });

  test("the owner's saved tasks survive the new code unchanged", async (t) => {
    const real = path.join(ROOT, 'data', 'tasks.json');
    if (!fs.existsSync(real)) return t.skip('no data/tasks.json on this machine');
    const s = scratch('real');
    fs.copyFileSync(real, path.join(s.data, 'tasks.json')); // a copy: the real file is only read
    const before = JSON.parse(fs.readFileSync(real, 'utf8'));
    const office = await startOffice({ brain: s.brain, data: s.data });
    try {
      const after = await office.tasks();
      assert.equal(after.length, before.length);
      for (const b of before) {
        const a = after.find(x => x.id === b.id);
        if (b.state === 'waiting') { assert.equal(a.state, 'waiting'); assert.equal(a.draft, b.draft); assert.equal(a.draftHash, hash(b.draft)); }
        else assert.deepEqual(a, b, `${b.id} changed`);
      }
      assert.equal(office.calls().length, 0, 'booting on the real task list ran nothing');
    } finally { await office.stop(); s.cleanup(); }
  });
});
