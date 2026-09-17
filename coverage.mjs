// Agents Office — skill coverage and readiness, role by role (Phase 4 of the reliability handoff).
//
// A job title is not a capability, and "the department has a brief" is not "this agent can do the
// work". This report says, for every one of the 119 seats, what it actually has and how far that has
// been proved:
//
//   generic      only what every agent gets (the house style) — nothing written for this seat or its department
//   briefed      a brief or a skill written for this seat exists, but nobody has written down what it
//                must and must not do, or checked it
//   contracted   a capability contract exists and is complete (contracts/<id>.md, every section below)
//   tested       contracted, plus the three fixture cases (normal, missing input, misleading input)
//                exist AND a reviewed result is recorded as passing for the current contract
//
// Nothing here runs Claude or grades work. "tested" can only come from a review the owner records.
//
//   <brain>/Agents Office/contracts/<id>.md          the contract (headings below)
//   <brain>/Agents Office/fixtures/<id>/normal.md    a representative task
//   <brain>/Agents Office/fixtures/<id>/missing-input.md
//   <brain>/Agents Office/fixtures/<id>/misleading-input.md
//   <brain>/Agents Office/fixtures/<id>/review.json  { "contractHash": "…", "passed": true, "reviewedBy": "owner", "reviewedAt": "…", "notes": "…" }
//
//   npm run coverage             prints the summary, writes data/coverage.json
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const CONTRACT_SECTIONS = ['Purpose', 'Triggers', 'Required inputs', 'Boundaries', 'Allowed tools', 'Procedure', 'Output', 'Quality rubric', 'Source standards', 'Escalate when', 'Worked example'];
export const FIXTURE_CASES = ['normal', 'missing-input', 'misleading-input'];
// The seats the first paying client runs through (handoff Phase 6): research, qualification,
// outreach drafting, proposals, quality review, delivery planning. These are contracted first.
export const FIRST_CLIENT = { pros: 'research prospects', enzo: 'enrich and research', ilm: 'qualify', lexi: 'qualify and own the pipeline', folo: 'draft follow-ups', cmail: 'draft client emails', piper: 'proposals', qa: 'quality review', dlead: 'delivery planning', pco: 'delivery planning' };
export const LEVELS = ['generic', 'briefed', 'contracted', 'tested'];

const dirs = brainPath => ({ contracts: path.join(brainPath, 'Agents Office', 'contracts'), fixtures: path.join(brainPath, 'Agents Office', 'fixtures') });
const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex').slice(0, 16);
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Parse a contract: which required sections are present and non-empty. */
export function checkContract(text) {
  const found = new Map();
  let cur = null;
  for (const line of String(text).split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { cur = CONTRACT_SECTIONS.find(s => norm(s) === norm(h[1])) || null; if (cur && !found.has(cur)) found.set(cur, ''); continue; }
    if (cur) found.set(cur, found.get(cur) + line.trim());
  }
  const missing = CONTRACT_SECTIONS.filter(s => !found.has(s));
  const empty = CONTRACT_SECTIONS.filter(s => found.has(s) && !found.get(s));
  return { complete: !missing.length && !empty.length, missing, empty };
}

/**
 * agents: the roster · skills: loadSkills() result · lessons: id → count ·
 * usableTools: normalised names of connected + allowed connectors (null when unknown)
 */
export function coverage({ agents, skills, brainPath, lessons = () => 0, usableTools = null }) {
  const { contracts, fixtures } = dirs(brainPath);
  const roles = agents.map(a => {
    const mine = skills.forAgent(a);
    const specific = mine.filter(s => !s.everyone).map(s => s.name); // written for this seat or its department's work
    const shared = mine.filter(s => s.everyone).map(s => s.name);      // what every agent gets (house style)
    const brief = typeof a.brief === 'string' ? a.brief.trim() : Array.isArray(a.brief) ? a.brief.join('\n').trim() : '';
    let contract = { exists: false, complete: false, missing: CONTRACT_SECTIONS, hash: null };
    try { const text = fs.readFileSync(path.join(contracts, a.id + '.md'), 'utf8'); contract = { exists: true, ...checkContract(text), hash: hash(text) }; } catch {}
    const fx = path.join(fixtures, a.id);
    const cases = FIXTURE_CASES.filter(c => fs.existsSync(path.join(fx, c + '.md')));
    let review = null; try { review = JSON.parse(fs.readFileSync(path.join(fx, 'review.json'), 'utf8')); } catch {}
    let lastRun = null; try { const runs = fs.readdirSync(fx).filter(n => /^results-.*\.json$/.test(n)).sort(); if (runs.length) { const r = JSON.parse(fs.readFileSync(path.join(fx, runs.at(-1)), 'utf8')); lastRun = { file: runs.at(-1), at: r.at, passed: r.passed, live: r.live }; } } catch {}
    const reviewCurrent = !!(review && review.passed === true && contract.hash && review.contractHash === contract.hash);
    const level = contract.complete && cases.length === FIXTURE_CASES.length && reviewCurrent ? 'tested'
      : contract.complete ? 'contracted'
      : brief || specific.length ? 'briefed' : 'generic';
    const tools = (a.tools || []).map(t => ({ name: t, usable: usableTools ? usableTools.some(u => norm(u).includes(norm(t)) || norm(t).includes(norm(u))) : null }));
    const gaps = [];
    if (!brief && !specific.length) gaps.push('only the house style — nothing written for this work');
    if (!contract.exists) gaps.push('no capability contract');
    else if (!contract.complete) gaps.push('contract incomplete: ' + [...contract.missing, ...contract.empty].join(', '));
    const noCases = FIXTURE_CASES.filter(c => !cases.includes(c)); if (noCases.length) gaps.push('no fixture: ' + noCases.join(', '));
    if (cases.length && !lastRun) gaps.push('fixture checks never run (node fixtures.mjs ' + a.id + ')'); else if (lastRun && !lastRun.passed) gaps.push('last fixture run failed its checks');
    if (review && !reviewCurrent) gaps.push(review.passed !== true ? 'last review did not pass' : 'review is for an older contract');
    else if (!review) gaps.push('never reviewed');
    const dead = tools.filter(t => t.usable === false).map(t => t.name); if (dead.length) gaps.push('tools not connected: ' + dead.join(', '));
    return { id: a.id, department: a.department, lead: !!a.lead, name: a.name, role: a.role, level, firstClient: FIRST_CLIENT[a.id] || null,
      brief: brief.length, skills: { specific, shared }, lessons: lessons(a.id), contract: { exists: contract.exists, complete: contract.complete }, fixtures: cases, lastRun, reviewed: reviewCurrent, tools, gaps };
  });
  const by = LEVELS.map(l => [l, roles.filter(r => r.level === l).length]);
  const first = roles.filter(r => r.firstClient);
  return { at: new Date().toISOString(), roles: roles.length, levels: Object.fromEntries(by), firstClient: { roles: first.length, levels: Object.fromEntries(LEVELS.map(l => [l, first.filter(r => r.level === l).length])) }, list: roles };
}

export function summaryText(c) {
  const lines = [`${c.roles} seats · ` + LEVELS.map(l => `${l} ${c.levels[l]}`).join(' · '),
    `first-client path (${c.firstClient.roles} seats) · ` + LEVELS.map(l => `${l} ${c.firstClient.levels[l]}`).join(' · '), ''];
  for (const r of c.list.filter(x => x.firstClient)) lines.push(`  ${r.level.padEnd(10)} ${r.id.padEnd(8)} ${r.name} — ${r.firstClient}${r.gaps.length ? '\n             gaps: ' + r.gaps.join('; ') : ''}`);
  return lines.join('\n');
}

if (process.argv[1] && path.basename(process.argv[1]) === 'coverage.mjs') { // run directly (npm run coverage), not imported
  const { loadConfig, ROOT } = await import('./config.mjs');
  const { loadRoster } = await import('./roster.mjs');
  const { loadSkills } = await import('./skills.mjs');
  const learn = await import('./learn.mjs');
  const cfg = loadConfig();
  const agents = loadRoster(cfg.brainPath).agents;
  const c = coverage({ agents, skills: loadSkills(cfg.brainPath, agents), brainPath: cfg.brainPath, lessons: id => learn.count(cfg.brainPath, id) });
  const out = path.join(process.env.AO_DATA || path.join(ROOT, 'data'), 'coverage.json');
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(c, null, 2));
  console.log(summaryText(c));
  console.log(`\nfull report (all ${c.roles} seats, with gaps): ${out}`);
}
