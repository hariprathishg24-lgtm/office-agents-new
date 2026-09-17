// Agents Office — run a seat's fixture cases and check them (Phase 4 of the reliability handoff).
//
//   node fixtures.mjs <agent id | first-client> [--fake]
//
// Starts a throwaway office (a copy of the brain, empty task data, no clock, nothing approved, so
// nothing can be sent), gives each fixture in <brain>/Agents Office/fixtures/<id>/ to that seat, and
// checks the answer deterministically:
//   - it ends in the expected state (a draft waiting for the OK, or a finished report)
//   - every mustMatch pattern is present, no mustNotMatch pattern is
//   - every price it writes appears in the offer-ladder note (no invented price)
//   - it claims no past work, clients or results (company-stage: we have none)
//   - a draft does not claim to have sent anything
// Results go to fixtures/<id>/results-<time>.json for the owner to read. Passing checks is NOT a
// pass: only the owner's review (POST /api/coverage/<id>/review) makes a seat "tested".
// Without --fake this uses your real Claude login: 3 cases a seat, plus a QA review for drafts.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, ROOT } from './config.mjs';
import { loadRoster } from './roster.mjs';
import { FIRST_CLIENT, FIXTURE_CASES } from './coverage.mjs';

export function parseFixture(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) { const kv = line.match(/^(\w+):\s*(.*)$/); if (kv) { try { meta[kv[1]] = JSON.parse(kv[2]); } catch { meta[kv[1]] = kv[2].trim(); } } }
  const task = (m[2].match(/## Task\s*\n([\s\S]*?)(\n## |$)/) || [])[1]?.trim() || '';
  return { meta, task, body: m[2] };
}

const money = s => [...String(s).matchAll(/(?:\$|₹|Rs\.?\s?|USD\s?|INR\s?)\s?(\d[\d,]*(?:\.\d+)?)(\s?[kK])?/g)].map(x => Math.round(parseFloat(x[1].replace(/,/g, '')) * (x[2] ? 1000 : 1)));
/** Deterministic checks on one answer. */
export function check(fixture, task, ladderText) {
  const out = String(task.draft || task.result || '');
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });
  add(`ends ${fixture.meta.expect}`, task.state === fixture.meta.expect, `state: ${task.state}${task.error ? ' (error)' : ''}`);
  for (const p of fixture.meta.mustMatch || []) add(`says: /${p}/`, new RegExp(p, 'i').test(out));
  for (const p of fixture.meta.mustNotMatch || []) add(`does not say: /${p}/`, !new RegExp(p, 'i').test(out));
  const allowed = new Set(money(ladderText));
  const invented = money(out).filter(n => n >= 100 && !allowed.has(n));
  add('every price is on the offer ladder', !invented.length, invented.length ? 'not on the ladder: ' + [...new Set(invented)].join(', ') : '');
  add('claims no past work, clients or results', !/\b(our (past |existing )?clients|clients (like|such as)|we('ve| have) (helped|worked with|grown) \d+|case stud(y|ies) (show|prove)|\d+\+? (happy |satisfied )?(clients|customers|companies|firms|businesses|consultancies|agencies)|track record of)\b/i.test(out));
  if (fixture.meta.expect === 'waiting') add('a draft claims nothing was sent', !/\b(I|we)('ve| have)? (just )?(sent|emailed|posted|published)\b|has been sent\b/i.test(out));
  return { passed: checks.every(c => c.ok), checks };
}

async function startOffice({ brain, data, fake }) {
  const port = 6100 + Math.floor(Math.random() * 500);
  const env = { ...process.env, PORT: String(port), AO_DATA: data, AO_BRAIN: brain, AO_CLOCK: 'off', AO_USAGE: 'off' };
  if (fake) env.AO_CLAUDE = path.join(ROOT, 'test', 'fake-claude.mjs');
  const p = spawn(process.execPath, ['serve.mjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', d => { log += d; }); p.stderr.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 200; i++) { try { if ((await fetch(base + '/api/health')).ok) return { p, base, log: () => log }; } catch {} await new Promise(r => setTimeout(r, 250)); }
  p.kill(); throw new Error('the test office did not start:\n' + log.slice(-800));
}

export async function runSeat(id, { fake = false, brainPath, quiet = false } = {}) {
  const cfg = loadConfig(); const brain = brainPath || cfg.brainPath;
  const agent = loadRoster(brain).agents.find(a => a.id === id); if (!agent) throw new Error('no agent ' + id);
  const dir = path.join(brain, 'Agents Office', 'fixtures', id);
  const cases = FIXTURE_CASES.map(c => ({ c, file: path.join(dir, c + '.md') })).filter(x => fs.existsSync(x.file)).map(x => ({ ...x, f: parseFixture(fs.readFileSync(x.file, 'utf8')) }));
  if (!cases.length) throw new Error(`no fixtures for ${id} in ${dir}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-fixtures-'));
  const brainCopy = path.join(tmp, 'brain'), data = path.join(tmp, 'data');
  fs.cpSync(brain, brainCopy, { recursive: true, filter: src => !/[\\/]\.git([\\/]|$)/.test(src) });
  fs.writeFileSync(path.join(brainCopy, 'Agents Office', 'routines.json'), '{"routines": []}\n');
  const ladder = (() => { for (const p of [path.join(brain, '10-Business', 'offer-ladder.md')]) { try { return fs.readFileSync(p, 'utf8'); } catch {} } return ''; })();
  const office = await startOffice({ brain: brainCopy, data, fake });
  const results = [];
  try {
    for (const { c, f } of cases) {
      const api = async (method, url, b) => { const r = await fetch(office.base + url, { method, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return r.json(); };
      const t = await api('POST', '/api/tasks', { dept: agent.department, agent: id, text: f.task, needsOk: f.meta.needsOk === true });
      if (t.error) throw new Error(t.error);
      const done = await api('POST', `/api/tasks/${t.id}/run`); // never approved: a draft stays a draft
      const verdict = check(f, done, ladder);
      results.push({ case: c, task: f.task, state: done.state, error: !!done.error, review: done.review || null, output: done.draft || done.result, ...verdict });
      if (!quiet) console.log(`${verdict.passed ? '✓' : '✗'} ${id} ${c}: ${verdict.checks.filter(x => !x.ok).map(x => x.name + (x.detail ? ' (' + x.detail + ')' : '')).join('; ') || 'all checks passed'}`);
    }
  } finally { office.p.kill(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  const record = { agent: id, at: new Date().toISOString(), live: !fake, passed: results.every(r => r.passed), results };
  if (!fake) fs.writeFileSync(path.join(dir, `results-${record.at.replace(/[:.]/g, '-')}.json`), JSON.stringify(record, null, 2));
  return record;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, 'fixtures.mjs')) {
  const which = process.argv[2]; const fake = process.argv.includes('--fake');
  if (!which) { console.log('usage: node fixtures.mjs <agent id | first-client> [--fake]'); process.exit(2); }
  const ids = which === 'first-client' ? Object.keys(FIRST_CLIENT) : [which];
  let all = true;
  for (const id of ids) { try { const r = await runSeat(id, { fake }); all &&= r.passed; } catch (e) { all = false; console.log(`✗ ${id}: ${e.message}`); } }
  console.log(all ? '\nall fixture checks passed — the owner still reviews the answers before a seat counts as tested' : '\nsome fixture checks failed — see above');
  process.exit(all ? 0 : 1);
}
