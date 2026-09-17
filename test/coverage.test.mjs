// Phase 4 of the reliability handoff: every seat has a readiness level, and "tested" cannot be claimed
// without a complete contract, all three fixture cases and a passing review of THAT contract.   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { coverage, checkContract, CONTRACT_SECTIONS, FIRST_CLIENT } from '../coverage.mjs';
import { loadRoster } from '../roster.mjs';
import { loadSkills } from '../skills.mjs';
import { scratch } from './helpers.mjs';

const contractText = CONTRACT_SECTIONS.map(s => `## ${s}\nFixture text for ${s}.`).join('\n\n');
const hash = t => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);

test('all 119 seats get a level, and nothing is contracted or tested by default', () => {
  const s = scratch('coverage');
  try {
    const agents = loadRoster(s.brain).agents;
    const c = coverage({ agents, skills: loadSkills(s.brain, agents), brainPath: s.brain });
    assert.equal(c.roles, 119);
    assert.equal(c.levels.contracted + c.levels.tested, 0);
    assert.equal(c.levels.generic + c.levels.briefed, 119);
    assert.equal(c.firstClient.roles, Object.keys(FIRST_CLIENT).length);
    for (const id of Object.keys(FIRST_CLIENT)) assert.ok(agents.some(a => a.id === id), `first-client seat ${id} is on the roster`);
    for (const r of c.list) assert.ok(r.gaps.length, `${r.id} shows its gaps`);
  } finally { s.cleanup(); }
});

test('fixture checks catch an off-ladder price, invented proof, a claimed send and a wrong end state', async () => {
  const { check, parseFixture } = await import('../fixtures.mjs');
  const f = parseFixture('---\ncase: "normal"\nagent: "piper"\nneedsOk: true\nexpect: "waiting"\nmustMatch: ["\\\\$6,500"]\nmustNotMatch: ["discount"]\n---\n# x\n\n## Task\nWrite it.\n');
  const ladder = '| Growth retainer | $3,500/mo | **$6,500/mo** | $12,000/mo |\n| ₹1,50,000/mo |';
  assert.equal(check(f, { state: 'waiting', draft: 'Growth: $6,500/mo, or Essential at $3,500/mo. Next step: call on Monday.' }, ladder).passed, true);
  const bad = check(f, { state: 'done', draft: 'Growth at $4,000/mo with a discount. We have helped 40 consultancies. I have sent it.' }, ladder);
  const failed = bad.checks.filter(c => !c.ok).map(c => c.name);
  assert.ok(failed.includes('ends waiting') && failed.includes('says: /\\$6,500/') && failed.includes('does not say: /discount/'));
  assert.ok(failed.includes('every price is on the offer ladder') && failed.includes('claims no past work, clients or results') && failed.includes('a draft claims nothing was sent'));
  assert.equal(check(f, { state: 'waiting', draft: 'Growth ₹1,50,000/mo and $6,500/mo' }, ladder).checks.find(c => c.name === 'every price is on the offer ladder').ok, true, 'Indian number format is understood');
});

test('a contract missing a section, or with an empty one, is not complete', () => {
  assert.equal(checkContract(contractText).complete, true);
  const noRubric = contractText.replace('## Quality rubric\nFixture text for Quality rubric.', '');
  assert.deepEqual(checkContract(noRubric).missing, ['Quality rubric']);
  const empty = contractText.replace('Fixture text for Boundaries.', '');
  assert.deepEqual(checkContract(empty).empty, ['Boundaries']);
});

test('tested needs contract + three fixtures + a passing review of the current contract', () => {
  const s = scratch('tested');
  try {
    const agents = loadRoster(s.brain).agents;
    const level = () => coverage({ agents, skills: loadSkills(s.brain, agents), brainPath: s.brain }).list.find(r => r.id === 'piper');
    const office = path.join(s.brain, 'Agents Office');
    fs.mkdirSync(path.join(office, 'contracts'), { recursive: true });
    fs.writeFileSync(path.join(office, 'contracts', 'piper.md'), contractText);
    assert.equal(level().level, 'contracted');
    const fx = path.join(office, 'fixtures', 'piper'); fs.mkdirSync(fx, { recursive: true });
    for (const c of ['normal', 'missing-input', 'misleading-input']) fs.writeFileSync(path.join(fx, c + '.md'), 'a case');
    assert.equal(level().level, 'contracted', 'fixtures without a review are not tested');
    fs.writeFileSync(path.join(fx, 'review.json'), JSON.stringify({ contractHash: hash(contractText), passed: true, reviewedBy: 'owner' }));
    assert.equal(level().level, 'tested');
    fs.writeFileSync(path.join(office, 'contracts', 'piper.md'), contractText + '\nA changed rule.');
    const after = level();
    assert.equal(after.level, 'contracted', 'changing the contract voids the old review');
    assert.ok(after.gaps.includes('review is for an older contract'));
  } finally { s.cleanup(); }
});
