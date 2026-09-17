// Agents Office — the local server (Beta).
// Serves the office and makes it real on your own Claude login:
//   · the command bar routes a typed task through Claude to the right agent in the department
//   · the agent produces the deliverable, which is saved as a note in your brain folder
//   · the Brain is your vault's real wiki-link graph, rebuilt live as notes are written
//   · chat with any agent is a real conversation in that agent's persona, grounded in your notes
// Everything stays on this machine: data/tasks.json and <brain>/Agents Office/*.md.
//
//   npm start                 → http://localhost:4520
//   PORT=4600 npm start       → another port
//
// Claude backend: the Claude Code CLI (`claude -p`, your existing login) — or the official SDK
// if ANTHROPIC_API_KEY is set. AO_MODEL=<model> overrides the model.
//
// V3.1: the connectors are real — the MCP servers your Claude Code is connected to are what the
// top bar shows and what the agents can call (mcp.mjs); the roster is yours (office.agents.json,
// roster.mjs). Tool calls only happen on the CLI backend: the SDK path has no MCP servers.
// V3.2: how the work is done is yours too — each agent's `brief` (roster.mjs) and the skills
// bound to it (skills.mjs: skills/ + <brain>/Agents Office/skills/) go into every task and chat.
// V3.3: the agents learn — every "revise: …" is recorded and standing rules come back into the
// prompt (learn.mjs); a department lead interviews the owner in chat and writes the briefs and a
// skill for its team (onboard.mjs). Roster, skills and lessons are re-read before every task.
// V3.5: routines — the office keeps its own clock (routines.mjs + src/when.js). A routine in
// <brain>/Agents Office/routines.json fires at its minute whether or not the page is open; the
// server creates the task, runs it here, and a result that needs the owner's OK waits in
// WAITING ON APPROVAL until /approve (the agent then does the outbound step) or /reject (with a
// note, which the agent learns from). Emails, Accounting and Sales only in this release.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig, ROOT } from './config.mjs';
import { layoutGraph, readVault, readOfficeNotes } from './graph-build.mjs';
import { DEPTS, DEPT_KEYS } from './src/data.js';
import * as mcp from './mcp.mjs';
import { loadRoster } from './roster.mjs';
import { loadSkills } from './skills.mjs';
import * as learn from './learn.mjs';
import * as onboard from './onboard.mjs';
import * as routines from './routines.mjs';
import * as usage from './usage.mjs';
import { normModel, modelFor, modelArgs, modelId, modelName, MODEL_KEYS, DEFAULT_MODEL, normEffort, effortFor, effortName, EFFORT_KEYS } from './src/models.js';
import { parseWhen, describe, valid as validWhen, untilText } from './src/when.js';
import { claudeBin, claudeSource, spawnClaude } from './claude-bin.mjs';
import { readJSON, writeJSON, StoreError } from './store.mjs';
import * as brainGit from './brain-git.mjs';
import { scrub } from './scrub.mjs';
import * as coord from './coordinator.mjs';
import * as acq from './acquisition.mjs';
import * as research from './research.mjs';
import * as ops from './ops.mjs';
import * as coverageMod from './coverage.mjs';

const cfg = loadConfig();
const HTML = path.join(ROOT, 'dist', 'command-centre-v2.html'); // built by build.mjs; shipped so npm start works without a build
const DATA = process.env.AO_DATA ? path.resolve(process.env.AO_DATA) : path.join(ROOT, 'data'); // AO_DATA: the tests and npm run check keep their state away from the real office
const FILE = path.join(DATA, 'tasks.json');
const BRAIN = cfg.brainPath;
const NOTES_DIR = path.join(BRAIN, 'Agents Office');
const CLI_CWD = path.join(os.tmpdir(), 'agents-office-cli'); // an empty cwd: no CLAUDE.md, no repo context
const version = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '?'; } })();
const RUN_TIMEOUT = +process.env.AO_TIMEOUT_MS || Math.max(60, +cfg.timeout || 300) * 1000; // agents with tools take longer than a plain draft · AO_TIMEOUT_MS: tests only
const CLOCK_ON = process.env.AO_CLOCK !== 'off';   // off: routines never fire (npm run check, the tests) — the clock must not run real work against real state
const USAGE_ON = process.env.AO_USAGE !== 'off';   // off: no call to Claude's usage endpoint
const HOST = process.env.AO_HOST || cfg.host || '127.0.0.1'; // this machine only: the API has no login, and it can approve outbound sends
// Claim before connector discovery or any startup work can touch shared state.
{
  const lock = await ops.acquireLock(DATA, { port: cfg.port, host: HOST });
  if (!lock.ok) { console.error(`✗ office lock prevents startup on ${DATA}: another office may already be running (pid ${lock.holder.pid}, port ${lock.holder.port}). ${lock.reason || 'Stop the other office before starting this one.'}`); process.exit(1); }
  if (lock.tookOver) console.log(`  lock: the previous office (pid ${lock.tookOver.pid}) did not shut down cleanly — taking over`);
}
process.on('exit', () => ops.releaseLock(DATA));
const STARTED = Date.now();
const CHILDREN = new Set(); // running Claude processes
const MAX_ATTEMPTS = 3; // a task is attempted at most this many times in total (restarts and read-only retries included)
const RETRY_BASE = +process.env.AO_RETRY_BASE_MS || 60 * 1000; // first backoff for a read-only retry; each next one waits 4x longer
{ const m = normModel(cfg.model); if (cfg.model && !m) console.warn(`config: model must be sonnet, opus or fable (got "${cfg.model}") — using ${DEFAULT_MODEL}`); cfg.model = m || DEFAULT_MODEL; } // V3.6: three models, by name
{ const e = normEffort(cfg.effort); if (cfg.effort && !e) console.warn(`config: effort must be low, medium, high, xhigh or max (got "${cfg.effort}") — using the model's own`); cfg.effort = e || ''; } // V3.6.1: the office's effort, empty = the model's own
mcp.configure(cfg);
const roster = loadRoster(BRAIN);
const AGENTS = roster.agents; // id · department · lead · name · role · does · tools · brief
for (const w of roster.problems) console.warn('agents:', w);
let skills = loadSkills(BRAIN, AGENTS); // reloaded before every task and chat, so a new skill needs no restart
for (const w of skills.problems) console.warn('skills:', w);
// the roster's editable fields are re-read too (a brief written by the lead's interview, or by hand, lands without a restart)
function reloadRoster() {
  const r = loadRoster(BRAIN);
  for (const a of r.agents) { const cur = AGENTS.find(x => x.id === a.id); if (cur) Object.assign(cur, { name: a.name, role: a.role, does: a.does, tools: a.tools, brief: a.brief }); }
  if (r.problems.join() !== roster.problems.join()) for (const w of r.problems) console.warn('agents:', w);
  Object.assign(roster, { problems: r.problems, customised: r.customised, briefed: r.briefed, files: r.files });
}
const refreshSkills = () => { reloadRoster(); const s = loadSkills(BRAIN, AGENTS); if (s.problems.join() !== skills.problems.join()) for (const w of s.problems) console.warn('skills:', w); skills = s; return s; };
const leadOf = dept => AGENTS.find(a => a.department === dept && a.lead) || AGENTS.find(a => a.department === dept);
const setupMap = () => Object.fromEntries(DEPT_KEYS.map(k => [k, onboard.isSetUp(AGENTS, skills, k)]));

let backend = 'claude-cli', sdk = null;
if (process.env.ANTHROPIC_API_KEY) {
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    sdk = new Anthropic(); backend = 'anthropic-sdk';
  } catch (e) { console.warn('SDK not installed (npm install @anthropic-ai/sdk) — using the Claude CLI:', e.message.split('\n')[0]); }
}

/* ---------- storage ---------- */
// Missing file = no tasks yet. A damaged file is NOT "no tasks": store.mjs keeps the damaged copy,
// falls back to the last good one, and otherwise throws, so a save can never write [] over it.
const load = () => { const v = readJSON(FILE, []); if (!Array.isArray(v)) throw new StoreError(FILE + ' does not hold a task list', FILE); return v; };
const save = list => { let prev = []; try { prev = readJSON(FILE, []); } catch {} writeJSON(FILE, coord.stampHistory(list, prev)); }; // every change of state lands in task.history with its reason
const nid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
/* ---------- the usage gauge (V3.6, A3): Claude's own numbers, the office's count underneath ---------- */
const USTATE = usage.loadState(DATA);
let usageCache = { at: 0, value: null, stale: true };
async function getUsage(force) {
  if (!force && !usageCache.stale && usageCache.value && Date.now() - usageCache.at < 60000) return usageCache.value;
  // AO_USAGE_PERCENT: a fixed session percent, for the tests of the usage hold (never set it in the office)
  const pinned = process.env.AO_USAGE_PERCENT !== undefined && process.env.AO_USAGE_PERCENT !== '' ? Number(process.env.AO_USAGE_PERCENT) : null;
  const u = Number.isFinite(pinned) ? { ok: true, source: 'test', session: { percent: pinned } }
    : USAGE_ON ? await usage.fetchUsage() : { ok: false, reason: 'usage checks are off (AO_USAGE=off)' };
  const v = u.ok ? { ...u, office: usage.fallback(USTATE).window } : { ...usage.fallback(USTATE), reason: u.reason };
  usageCache = { at: Date.now(), value: v, stale: false };
  return v;
}
function bumpUsage(u) { if (!u) return; Object.assign(USTATE, usage.record(USTATE, u)); usage.saveState(DATA, USTATE); usageCache.stale = true; }
const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/* ---------- ask Claude ---------- */
// askX → { text, tools }: tools = the MCP/web tools the agent actually called (for the office to
// light up). On the CLI the agent gets --allowedTools = every connected server the config allows
// (+ web); file tools, Bash and sub-agents stay off — the office is not a coding session.
// images: [{ media_type, data }] — when present the message goes in as content blocks through
// --input-format stream-json, which is how the CLI takes a picture without the agent needing file
// tools (it never gets Read/Glob/Bash).
// The system prompt is built most-important-first — who you are, the rules, your tools, the company
// notes, and last the notes picked for this one task. It travels to the CLI as a FILE
// (--system-prompt-file): on the command line it counted against Windows' 32,767-character limit,
// which is why the company notes used to be cut short while the prompt told the agent they were
// complete. The budget below is a sanity bound on the file, and anything past it is named as cut.
const SYS_MAX = 150000;
function fitSystem(system) {
  if (system.length <= SYS_MAX) return system;
  console.warn(`  ⚠ system prompt ${system.length} chars — cut to ${SYS_MAX}`);
  return system.slice(0, SYS_MAX) + `\n\n[CUT: the last ${system.length - SYS_MAX} characters of these instructions (the task notes at the end) did not fit and are NOT above. If you need something that is not here, say it is missing — do not guess it.]`;
}
// A failed run carries what the office needs to decide what happens next:
//   phase          'spawn' (Claude never started) · 'timeout' · 'exit' · 'result' (Claude reported an error) · 'empty' · 'api'
//   toolsAttempted how many tool calls the agent had started — 0 means nothing outside this machine can have happened
//   partial        any text the agent produced before it failed (useful, but not a finished result)
function runError(message, fields) { return Object.assign(new Error(message), fields); }
async function askX(system, user, { dept = null, maxTokens = 4000, tools = true, timeout = RUN_TIMEOUT, model = cfg.model, effort = null, images = [], onToolUse = null } = {}) { // model: sonnet · opus · fable · effort: low…max or null = the model's own (src/models.js)
  if (sdk) {
    const content = images.length
      ? [...images.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } })), { type: 'text', text: user }]
      : user;
    let res;
    try { res = await sdk.messages.create({ model: modelId(model), max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }, { timeout, maxRetries: 1 }); }
    catch (e) { const slow = /timed? ?out/i.test(e.message); throw runError(slow ? `Claude took longer than ${timeout / 1000} s (API)` : 'Claude API: ' + e.message, { phase: slow ? 'timeout' : 'api', toolsAttempted: 0, partial: '' }); }
    if (res.stop_reason === 'refusal') throw runError('Claude declined this request', { phase: 'result', toolsAttempted: 0, partial: '' });
    bumpUsage(res.usage);
    return { text: res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(), tools: [], blocked: [], usage: res.usage, modelId: res.model };
  }
  if (!claudeBin(cfg)) throw runError(process.env.AO_CLAUDE || cfg.claudePath ? `Claude Code was not found at the configured path (${process.env.AO_CLAUDE || cfg.claudePath})` : 'Claude Code is not installed (claude not found on PATH or in the editor extension)', { phase: 'spawn', toolsAttempted: 0, partial: '' });
  fs.mkdirSync(CLI_CWD, { recursive: true });
  const allowed = tools ? mcp.allowedTools(dept) : []; // only the connectors wired to this agent's department (office.config.json mcp.departments widens them)
  // The message goes in over stdin and the system prompt as a file, so the command line stays short
  // whatever the size of the brain (CreateProcess stops at 32,767 characters).
  const sysFile = path.join(CLI_CWD, `system-${process.pid}-${nid()}.txt`);
  fs.writeFileSync(sysFile, fitSystem(system));
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--system-prompt-file', sysFile,
    '--disallowedTools', 'Bash,Edit,Write,Read,Glob,Grep,Agent,NotebookEdit,Task' + (allowed.includes('WebFetch') ? '' : ',WebFetch,WebSearch')];
  if (allowed.length) args.push('--allowedTools', allowed.join(','));
  args.push(...modelArgs(model, effort));
  const env = { ...process.env }; delete env.CLAUDECODE; // the CLI refuses to nest inside another Claude Code session
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false, timer = null;
    const cleanup = () => { try { fs.unlinkSync(sysFile); } catch {} };
    const fail = e => { if (settled) return; settled = true; clearTimeout(timer); cleanup(); reject(e); };
    const done = v => { if (settled) return; settled = true; clearTimeout(timer); cleanup(); resolve(v); };
    // A tool the agent REACHED FOR is not a tool it used: a denied connector (Notion) is refused
    // at the permission layer, but the attempt still shows up as a tool_use block. Logging those
    // the same way put "tools: Notion" in a note's frontmatter for a call that was blocked — the
    // audit trail could not tell "read the owner's Notion" from "was refused". So attempts are
    // held by id and only counted once a tool_result comes back that is not an error.
    let out = '', err = '', text = '', used = [], gotResult = false, isError = false, errorKind = '', usageOut = null, modelUsed = null, toolsAttempted = 0, said = '', costOut = null;
    const attempted = new Map(); // tool_use id → name, until its result says whether it worked
    const blocked = [];
    // what the agent was last seen doing — a timeout that says "calling Apollo, 240 s before the
    // deadline" can be diagnosed; "took longer than 300 s" cannot
    let last = { what: 'starting Claude', at: startedAt };
    const seen = what => { last = { what, at: Date.now() }; };
    const toolName = n => mcp.namesOf([n])[0] || n;
    let p;
    try { p = spawnClaude(claudeBin(cfg), args, { cwd: CLI_CWD, env, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { cleanup(); return reject(runError('Could not start Claude: ' + e.message, { phase: 'spawn', toolsAttempted: 0, partial: '' })); }
    CHILDREN.add(p); p.on('exit', () => CHILDREN.delete(p)); // a clean shutdown ends these instead of leaving them orphaned
    timer = setTimeout(() => {
      try { p.kill('SIGKILL'); } catch {}
      const open = [...attempted.values()].map(toolName);
      fail(runError(`Claude took longer than ${timeout / 1000} s — last activity: ${last.what}, ${Math.round((Date.now() - last.at) / 1000)} s before the deadline${open.length ? ' · tool call with no answer: ' + open.join(', ') : ''}`, { phase: 'timeout', toolsAttempted, partial: text || said.trim() }));
    }, timeout);
    p.on('error', e => fail(runError(e.code === 'ENOENT' ? 'Claude Code is not installed (claude not found on PATH)' : 'Could not start Claude: ' + e.message, { phase: 'spawn', toolsAttempted: 0, partial: '' })));
    p.stdin.on('error', e => { err += `\nstdin: ${e.message}`; }); // EPIPE when the CLI dies early: the close handler reports it; unhandled, it would take the office down
    p.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: [
      ...images.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } })),
      { type: 'text', text: user },
    ] } }) + '\n');
    p.stdin.end();
    const feed = line => {
      if (!line.trim()) return;
      let j; try { j = JSON.parse(line); } catch { return; }
      if (j.type === 'system' && j.subtype === 'init') { mcp.fromInit(j); seen('Claude started'); }
      if (j.type === 'assistant' && j.message?.content) for (const b of j.message.content) {
        if (b.type === 'tool_use' && b.name) { attempted.set(b.id, b.name); toolsAttempted++; seen('calling ' + toolName(b.name)); if (onToolUse) { try { onToolUse(b.name); } catch {} } }
        else if (b.type === 'text') { said += (said ? '\n' : '') + (b.text || ''); seen('writing'); }
      }
      if (j.type === 'user' && Array.isArray(j.message?.content)) for (const b of j.message.content) {
        if (b.type !== 'tool_result' || !attempted.has(b.tool_use_id)) continue;
        const name = attempted.get(b.tool_use_id); attempted.delete(b.tool_use_id);
        seen('reading the result of ' + toolName(name));
        if (b.is_error) { if (!blocked.includes(name)) blocked.push(name); continue; }
        if (!used.includes(name)) used.push(name);
      }
      if (j.type === 'result') { gotResult = true; text = String(j.result || '').trim(); isError = !!j.is_error; errorKind = j.subtype || ''; usageOut = j.usage || null; costOut = typeof j.total_cost_usd === 'number' ? j.total_cost_usd : null; modelUsed = Object.entries(j.modelUsage || {}).sort((x, y) => ((y[1] && (y[1].costUSD || y[1].outputTokens)) || 0) - ((x[1] && (x[1].costUSD || x[1].outputTokens)) || 0))[0]?.[0] || null; /* the model that did the work, not the first listed (the CLI also lists the small model it uses for housekeeping) */ }
    };
    p.stdout.on('data', d => { out += d; let i; while ((i = out.indexOf('\n')) >= 0) { feed(out.slice(0, i)); out = out.slice(i + 1); } });
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => {
      feed(out); out = '';
      if (settled) return; // the deadline (or a spawn error) already answered
      bumpUsage(usageOut);
      if (blocked.length) console.warn(`  ⚠ refused tool call${blocked.length > 1 ? 's' : ''}: ${mcp.namesOf(blocked).join(', ') || blocked.join(', ')}`);
      const partial = text || said.trim(); // what the agent had written: kept for the owner to see, never delivered as the result
      const fields = { toolsAttempted, partial, blocked, exitCode: code, cost: costOut }; // a failed run still cost something
      // A result flagged is_error is an error even when it carries text — that text is usually the error.
      if (gotResult && isError) return fail(runError(`Claude reported an error${errorKind && errorKind !== 'success' ? ` (${errorKind})` : ''}: ${(text || err.trim() || 'no detail').slice(0, 300)}`, { ...fields, phase: 'result' }));
      if (code !== 0) return fail(runError(`claude exited ${code}${err.trim() ? ': ' + err.trim().slice(0, 300) : ''}${partial ? ' (its partial output is kept, not delivered)' : ''}`, { ...fields, phase: 'exit' }));
      if (!gotResult) return fail(runError(`Claude ended without a result${err.trim() ? ': ' + err.trim().slice(0, 300) : ''}`, { ...fields, phase: 'empty' }));
      done({ text, tools: used, blocked, usage: usageOut, modelId: modelUsed, cost: costOut });
    });
  });
}
const ask = async (system, user, opts) => (await askX(system, user, { tools: false, ...opts })).text;
function parseJSON(text) {
  const s = text.replace(/```json|```/g, ''); const a = s.indexOf('{'), b = s.lastIndexOf('}');
  return JSON.parse(s.slice(a, b + 1));
}

/* ---------- the brain: graph + context ---------- */
let graph = { notes: 0, nodes: [], links: [], floor: [] };
async function rebuildGraph() {
  try { graph = await layoutGraph(BRAIN); } catch (e) { console.warn('brain graph failed:', e.message); }
  return graph;
}
// A note marked superseded or archived stays in the brain (and the graph) as history, but is never
// handed to an agent as a note to act on: "status: superseded" in its front matter, or the
// "> **SUPERSEDED …" banner the office puts at the top of an old deliverable.
const isSuperseded = text => /^---[\s\S]*?^status:\s*(superseded|archived)\b[\s\S]*?^---/mi.test(text.slice(0, 1500)) || /^>\s*\**\s*(SUPERSEDED|ARCHIVED)\b/m.test(text.slice(0, 2500));
function vaultIndex() { // name → text (vault notes + live office notes); .meta: name → { path, client, superseded }
  const { notes } = readVault(BRAIN); const m = new Map(); m.meta = new Map();
  const add = (name, text, p, client = false) => { m.set(name, text); m.meta.set(name, { path: p, client, superseded: isSuperseded(text) }); };
  for (const [name, n] of notes) add(name, n.text, n.path);
  for (const n of readOfficeNotes(BRAIN)) add(n.name, n.text, n.path, !!n.client);
  return m;
}
// Which version of which note informed a result: the path, when it last changed, a hash of exactly
// what the agent was given, and why it was picked. Kept on the task, so a result can be audited
// against the notes as they were, not as they are now.
function sourcesOf(index, names, why) {
  return names.filter(n => index.has(n)).map(n => {
    const meta = index.meta?.get(n) || {}; let modified = null;
    try { modified = fs.statSync(meta.path).mtime.toISOString(); } catch {}
    // effective: when the note says it took effect — "effective: 2026-09-16" in front matter, or "Approved/Settled <date>" in the text
    const text = index.get(n);
    const eff = (text.match(/^effective:\s*(\d{4}-\d{2}-\d{2})/m) || [])[1] || (() => { const m = text.match(/\b(?:approved|settled|decided|agreed)\b[^.\n]{0,40}?\b(\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4})/i); const d = m && Date.parse(m[1]); return d ? new Date(d - new Date(d).getTimezoneOffset() * 6e4).toISOString().slice(0, 10) : null; })();
    return { note: n, path: meta.path ? path.relative(BRAIN, meta.path).replace(/\\/g, '/') : null, modified, effective: eff, hash: hash(text), why };
  });
}
// The notes EVERY agent must have in front of it, whatever the task is about. These were left to
// the relevance search, which meant an agent could be asked to quote a client and never be shown
// the price list - it wrote "(price to confirm)" while the ladder sat in the vault. Anything the
// office must never get wrong belongs here, not in a relevance lottery.
const CORE_NOTES = [
  'CLAUDE',          // the rules: never invent a figure, price, proof or policy
  'company-stage',   // zero clients, zero revenue - what may and may not be claimed
  'goals',           // the one objective
  'business-model',  // a retainer business, and how delivery works
  'services',        // what we sell, what a partner delivers, what we do not sell yet
  'offer-ladder',    // THE only source of a price
  'icp',             // who we are for
  'voice',           // how we write
  // NOT 'index': it is a table of contents for notes that are already here, and a list of paths is
  // the exact thing that sent agents hunting for files they cannot open. Relevance search can
  // still surface it.
];
// Budgets, not silent slices. The core notes go in whole (all eight together are ~24k characters,
// and the prompt now travels as a file). A note is only cut if it outgrows its budget, and then the
// cut is written into the prompt, so the agent knows the rest exists and is not in front of it.
const CORE_NOTE_MAX = 12000, TASK_NOTE_MAX = 4000;
const clip = (name, text, max) => text.length <= max ? text
  : text.slice(0, max) + `\n[CUT: the rest of ${name}.md (${text.length - max} more characters) is NOT in this prompt. Do not guess what it says; say it is missing if you need it.]`;
// An agent has no file tools. Handed a path like `10-Business/offer-ladder.md` it goes looking for
// a document system it CAN reach — which is how Proposals ended up asking for Notion access and
// writing "(price to confirm)" with the price list sitting in its own prompt. So the block says
// outright that these notes are here, complete, and are not to be fetched from anywhere.
const NOTES_HEADER = [
  "COMPANY NOTES — the company's own brain, reproduced below. A note that had to be shortened says [CUT] where it stops.",
  'These are the authoritative source for who we are, what we sell and what it costs.',
  'They are already here: do NOT look for them in Notion, Drive, a CRM or any other tool, and never',
  'say you could not reach them. Where a skill names a path (e.g. `10-Business/offer-ladder.md`) it',
  'means the note of that name below — offer-ladder.md — not a file to go and open.',
].join('\n');
function businessContext(index) {
  const bits = [];
  for (const k of CORE_NOTES) {
    if (!index.has(k)) continue;
    bits.push('--- ' + k + '.md ---\n' + clip(k, index.get(k), CORE_NOTE_MAX));
  }
  return bits.join('\n\n');
}
// the notes an agent would read for this task: name/word overlap, department MOC first
function relevantNotes(index, dept, text, n = 4) {
  const words = new Set(String(text).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3));
  const mocName = { emails: 'MOC-Emails', sales: 'MOC-Sales', marketing: 'MOC-Marketing', ops: 'MOC-Operations', fin: 'MOC-Finance', delivery: 'MOC-Delivery' }[dept];
  const scored = [];
  for (const [name, txt] of index) {
    if (CORE_NOTES.includes(name) || name === 'log') continue; // already in every prompt
    const meta = index.meta?.get(name) || {};
    if (meta.superseded) continue; // history, not instructions
    const hay = (name + ' ' + txt.slice(0, 1500)).toLowerCase();
    let s = 0, named = false; for (const w of words) if (hay.includes(w)) { const inName = name.toLowerCase().includes(w); named ||= inName; s += inName ? 3 : 1; }
    if (meta.client && !named) continue; // a client's record goes only to a task that names that client, not to whatever shares a word with it
    if (name === mocName) s += 2;
    if (s) scored.push([s, name]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const picks = scored.slice(0, n).map(x => x[1]);
  if (mocName && index.has(mocName) && !picks.includes(mocName)) picks.push(mocName);
  return picks;
}
function contextText(index, names) {
  return names.map(n => `--- ${n}.md ---\n${clip(n, index.get(n) || '', TASK_NOTE_MAX)}`).join('\n\n');
}

/* ---------- the roster, as Claude sees it ---------- */
const persona = a => `${a.name}${a.lead ? ' (lead)' : ''} · ${a.role} · ${a.does}`;
function rosterText(dept) { return AGENTS.filter(a => a.department === dept).map(a => { const sk = skills.names(a); return `- ${a.id} · ${persona(a)}${sk.length ? ' · skills: ' + sk.join(', ') : ''}`; }).join('\n'); }
// what an agent is told about itself: the job, the owner's standing instructions, the skills it follows
function agentBrief(a) {
  const lessons = learn.promptText(BRAIN, a);
  let found = ''; try { found = research.promptText(research.forAgent(research.loadState(DATA), a.id)); } catch {} // reviewed industry findings, only for the roles they name
  return (a.brief ? `\nSTANDING INSTRUCTIONS FROM THE OWNER\n${a.brief}\n` : '') + (skills.promptText(a) ? `\n${skills.promptText(a)}\n` : '') + (lessons ? `\n${lessons}\n` : '') + (found ? `\n${found}\n` : '');
}
const toolKeys = names => [...new Set(names.map(n => /^mcp__/.test(n) ? mcp.keyOf(n) : n === 'WebSearch' || n === 'WebFetch' ? 'web' : null).filter(Boolean))];
async function route(dept, text) {
  const d = DEPTS[dept]; refreshSkills();
  const system = `You are the router for ${cfg.name}, a business whose departments are run by AI agents. ` +
    'Pick the single best agent for the owner\'s request — an agent whose skills match the request is the right one — and return ONLY a JSON object — no prose, no code fences.';
  const user = `Department: ${d.name}\nAgents (id · name · role · what they do):\n${rosterText(dept)}\n\nOwner's request: "${text}"\n\n` +
    'Return: {"agent":"<id from the list>","title":"<clean imperative task title, max 70 characters>","plan":["<step>","<step>","<step>"],"eta_minutes":<integer>,"why":"<one short sentence>","needs_ok":<true if doing this involves sending, posting, paying, deleting or changing anything outside this machine; false if it only reads and reports>}';
  const j = parseJSON(await ask(system, user, { maxTokens: 800, timeout: 150000, model: 'sonnet' })); // routing is a one-line JSON job: always Sonnet
  const valid = AGENTS.find(a => a.id === j.agent && a.department === dept);
  const agent = valid ? valid.id : (AGENTS.find(a => a.department === dept && a.lead) || AGENTS.find(a => a.department === dept)).id;
  return { agent, title: String(j.title || text).slice(0, 90), plan: Array.isArray(j.plan) ? j.plan.slice(0, 4).map(String) : [],
    eta: Number.isFinite(j.eta_minutes) ? j.eta_minutes : 30, why: String(j.why || ''), needsOk: typeof j.needs_ok === 'boolean' ? j.needs_ok : routines.guessNeedsOk(text) };
}
// mode: 'readonly' (judged to only read and report) · 'draft' (anything outbound: prepare it, send nothing) · 'approve' (the owner ticked this exact draft)
async function run(task, feedback, mode, { onToolUse } = {}) {
  const a = AGENTS.find(x => x.id === task.agent), d = DEPTS[a.department];
  refreshSkills();
  const index = vaultIndex();
  const read = relevantNotes(index, a.department, task.title + ' ' + task.text);
  const system = `You are ${a.name}, ${a.role || 'an agent'}, in the ${d.name} department of ${cfg.name}. ${a.does}\n${agentBrief(a)}` +
    'Write the finished deliverable itself, not a description of what you would do. Plain text: a short heading, then short sections or bullets. ' +
    'At most 260 words unless a skill or the owner\'s instructions set a different shape — those win. No preamble, no sign-off. Ground it in the company notes below; where a fact is missing, say plainly that it is missing — never invent a figure, price, client, result or policy to fill the gap. ' +
    'If you used a tool, say so in one line at the end ("Used: Gmail — searched the client thread").\n' +
    `If part of this is another agent's job, end with up to ${coord.MAX_HANDOFFS} lines "HANDOFF → <agent id>: <what they must do, with the facts they need>"; that work starts after yours is finished (for a draft, after the owner approves it). If you need a decision or a fact only the owner has, add a line "NEEDS OWNER: <the question>" instead of guessing. These lines are notes to the office and are never sent to anyone. Agent ids: ${AGENTS.filter(x => x.id !== a.id).map(x => `${x.id} (${x.name.toLowerCase()})`).join(', ')}.\n\n` +
    `${mcp.promptText(a.tools)}\n\n${NOTES_HEADER}\n\n${businessContext(index)}\n\nNOTES YOU READ FOR THIS TASK\n${contextText(index, read)}`;
  const routineLine = task.routine ? `\nThis is a routine (${task.when}): it runs on the office's own clock and the owner is not at the keyboard. It is now ${new Date().toLocaleString([], { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}${task.late ? `; this run is late, it was due ${new Date(task.due).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}. Do the work for now.` : '';
  const modeLine = mode === 'draft' ? '\nPrepare everything, but send, post, pay or change NOTHING outside this machine: the owner reads this first and approves it. End with one line saying exactly what will go out when approved. If it turns out nothing needs to go out (nothing found, nobody to contact), make the FIRST line exactly "NOTHING TO SEND", then say briefly what you checked — that is a finished report, not something for the owner to approve.'
    : mode === 'approve' ? `\nThe owner has APPROVED the draft below. Carry out the outbound step now, exactly as drafted, with your tools (send, post, update). If a tool you need is not connected, say so and show what you would have sent. Then report in one short section: what went out, to whom, and anything that did not. Do not hand off or ask anything in this step.${task.approval.recipient ? ` Send ONLY to ${task.approval.recipient}: the owner approved that recipient and no other.` : ''} If the tool gave back an id or a link for what went out (a message id, a post URL), end with one line "REF: <it>".\nApproved draft:\n${withoutControlLines(task.approval.draft)}`
    : '\nThis task was judged read-only: read, research and report. Send, post, pay, delete or change NOTHING outside this machine. If doing it properly needs an outbound step, draft that step and say it needs the owner\'s OK.';
  const user = `Task: ${task.title}\nOwner's request: ${task.text}` + (task.plan?.length ? `\nAgreed plan: ${task.plan.join(' → ')}` : '') + routineLine + modeLine +
    (feedback && mode !== 'approve' ? `\n\nThe owner reviewed your previous version and asked for changes: "${feedback}"\nPrevious version:\n${task.result}` : '');
  const pick = modelFor({ task: task.model, routine: task.routineModel, agent: a.model, office: cfg.model }); // four places, one precedence
  const eff = effortFor({ task: task.effort, routine: task.routineEffort, agent: a.effort, office: cfg.effort, model: pick.model }); // same places, then the model's own
  const { text, tools, blocked, modelId: ran, cost, usage: used } = await askX(system, user, { dept: a.department, model: pick.model, effort: eff.effort, onToolUse });
  const tokens = used ? (used.input_tokens || 0) + (used.output_tokens || 0) + (used.cache_creation_input_tokens || 0) + (used.cache_read_input_tokens || 0) : null;
  if (!text) throw Object.assign(new Error('Claude returned nothing'), { phase: 'empty', toolsAttempted: tools.length + blocked.length });
  const sources = [...sourcesOf(index, CORE_NOTES, 'core'), ...sourcesOf(index, read, 'relevant')];
  return { result: text, read, sources, costUSD: cost ?? null, tokens, tools: toolKeys(tools), used: mcp.namesOf(tools), blocked: mcp.namesOf(blocked).length ? mcp.namesOf(blocked) : blocked, skills: skills.names(a), modelUsed: pick.model, modelFrom: pick.from, modelId: ran, effortUsed: eff.effort || '', effortFrom: eff.from };
}
function writeNote(task) { // the deliverable becomes a note in the brain, linked to what was read
  fs.mkdirSync(NOTES_DIR, { recursive: true });
  const a = AGENTS.find(x => x.id === task.agent);
  const name = `${new Date(task.doneAt).toISOString().slice(0, 10)} ${slug(task.title)}`;
  // Last gate before disk: agents can read the owner's real Notion, Drive and CRM, and every note
  // is committed to git — so a quoted secret would become permanent history.
  const cleaned = scrub(task.result);
  if (cleaned.found.length) console.warn(`  ⚠ redacted from "${task.title}": ${cleaned.found.join(', ')}`);
  const body = `---\nagent: ${a.name}\ndepartment: ${DEPTS[a.department].name}\ntask: ${task.id}\ndone: ${new Date(task.doneAt).toISOString()}${task.used?.length ? '\ntools: ' + task.used.join(', ') : ''}${task.skills?.length ? '\nskills: ' + task.skills.join(', ') : ''}${task.routine ? '\nroutine: ' + task.when + (task.late ? ' (late)' : '') : ''}${task.modelUsed ? '\nmodel: ' + modelName(task.modelUsed) + (task.modelFrom && task.modelFrom !== 'office' ? ' (' + task.modelFrom + ')' : '') : ''}${task.effortUsed ? '\neffort: ' + task.effortUsed + (task.effortFrom && task.effortFrom !== 'model' ? ' (' + task.effortFrom + ')' : '') : ''}${task.approved ? '\napproved: ' + new Date(task.approvedAt).toISOString() : ''}\n---\n` +
    `# ${task.title}\n\n${cleaned.text}\n\n---\nRead: ${(task.read || []).map(n => `[[${n}]]`).join(' · ') || '—'}\n`;
  fs.writeFileSync(path.join(NOTES_DIR, name + '.md'), body);
  brainGit.snapshot(`${a.name}: ${task.title}`); // the vault keeps an undo history of agent writes
  return name;
}
async function chat(agentId, text, history, images = []) {
  const a = AGENTS.find(x => x.id === agentId); if (!a) throw new Error('unknown agent');
  const d = DEPTS[a.department]; refreshSkills();
  const index = vaultIndex();
  const read = relevantNotes(index, a.department, text, 3);
  const mine = load().filter(t => t.agent === agentId).slice(-6).map(t => `- [${t.state}] ${t.title}`).join('\n');
  const system = `You are ${a.name}, ${a.role || 'an agent'}, in the ${d.name} department of ${cfg.name}. ${a.does}\n${agentBrief(a)}` +
    (images.length ? `The owner attached ${images.length} image${images.length > 1 ? 's' : ''} to this message. Look at ${images.length > 1 ? 'them' : 'it'} and answer about what is actually there - never describe something you cannot see.\n` : '') +
    'You are talking to the owner. Answer as this agent, in first person, briefly (under 120 words unless asked for detail), plainly, no hype. ' +
    'Use the company notes; say when something is not in them. If the owner asks you to look something up, use your tools. Nothing outbound is sent without the owner\'s explicit say-so.\n\n' +
    `${mcp.promptText(a.tools)}\n\n${NOTES_HEADER}\n\n${businessContext(index)}\n\nRELEVANT NOTES\n${contextText(index, read)}\n\nYOUR RECENT TASKS\n${mine || '—'}`;
  const convo = (history || []).slice(-8).map(m => `${m.who === 'user' ? 'Owner' : a.name}: ${m.text}`).join('\n');
  const { text: reply, tools } = await askX(system, (convo ? convo + '\n' : '') + `Owner: ${text}\n${a.name}:`, { dept: a.department, maxTokens: 1200, model: modelFor({ agent: a.model, office: cfg.model }).model, effort: effortFor({ agent: a.effort, office: cfg.effort, model: modelFor({ agent: a.model, office: cfg.model }).model }).effort , images });
  return { reply, read, tools: toolKeys(tools), used: mcp.namesOf(tools) };
}

/* ---------- attachments ---------- */
// A chat message may carry pictures. Only real image types, 5 MB each, 4 at a time: the base64
// rides in the prompt, so an unbounded paste would blow the request and the model's context.
const IMG_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const IMG_MAX = 5 * 1024 * 1024, IMG_COUNT = 4;
function validateImages(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const im of list.slice(0, IMG_COUNT)) {
    if (!im || typeof im.data !== 'string') continue;
    const type = String(im.media_type || '').toLowerCase();
    if (!IMG_TYPES.includes(type)) continue;
    const data = im.data.includes(',') ? im.data.slice(im.data.indexOf(',') + 1) : im.data; // tolerate a data: URL
    if (data.length * 0.75 > IMG_MAX) continue;
    out.push({ media_type: type, data: data.replace(/\s+/g, ''), name: String(im.name || '').slice(0, 80) });
  }
  return out;
}

/* ---------- routines: the office's own clock (V3.5) ---------- */
const RSTATE = routines.loadState(DATA);
let rlist = { routines: [], problems: [], path: routines.file(BRAIN) };
function loadRoutines() { // re-read from disk every time: a routine written by Claude Code, or by hand, lands without a restart
  const r = routines.load(BRAIN, AGENTS);
  if (r.problems.join() !== rlist.problems.join()) for (const w of r.problems) console.warn('routines:', w);
  rlist = r;
  const { list, changed } = routines.withState(r.routines, RSTATE);
  if (changed) routines.saveState(DATA, RSTATE);
  return list;
}
const routinesOut = () => { const list = loadRoutines(); return { routines: list, depts: routines.ALLOWED, path: rlist.path, problems: rlist.problems }; };
const agentName = id => AGENTS.find(a => a.id === id)?.name || id;
// routine-driven runs go one at a time, so a burst of catch-ups after a long sleep does not spawn five Claude processes at once
let queue = Promise.resolve();
const enqueue = fn => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };
// A routine has at most one open run. RUN NOW pressed seven times used to start seven Claude runs of
// the same inbox check (17 Sep 2026); now it answers with the run already open. The clock skips a
// due time while the last run is unfinished or its draft still waits for the owner, rather than
// stacking a second draft of the same job on top of the first.
const OPEN_STATES = ['next', 'blocked', 'doing', 'review', 'waiting'];
function fire(r, { due = Date.now(), late = false, by = 'routine' } = {}) { // the routine becomes a task and runs here, page or no page
  const open = load().find(t => t.routine === r.id && OPEN_STATES.includes(t.state));
  if (open) {
    if (by === 'routine') { routines.advance(RSTATE, r, Date.now(), open.id, late); routines.saveState(DATA, RSTATE); console.log(`⏭ ${r.id} skipped: its last run ${open.id} is still ${open.state === 'waiting' ? 'waiting for your OK' : open.state}`); }
    return { ...open, existing: true };
  }
  const task ={ id: nid(), dept: r.dept, agent: r.agent, title: r.title, text: r.text, plan: r.plan || [], eta: 15, why: '', state: 'next', addedAt: Date.now(), by, routine: r.id, when: r.desc || describe(r.when), needsOk: r.needsOk, due, late, routineModel: r.model || undefined, routineEffort: r.effort || undefined, because: `routine ${r.id} fired${late ? ' late' : ''}` };
  const list = load(); list.push(task); save(list);
  routines.advance(RSTATE, r, Date.now(), task.id, late); routines.saveState(DATA, RSTATE);
  console.log(`⏱ ${task.id} → ${task.agent}: ${task.title}${late ? ' (LATE · was due ' + new Date(due).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ')' : ''}`);
  enqueue(() => startQueued(task.id));
  return task;
}

/* ---------- the task lifecycle ----------
   blocked ──prerequisites done──▶ next
   next ──run──▶ doing ──▶ done                 (judged read-only: needsOk false)
                      └──▶ review ──▶ waiting ──approve──▶ doing ──▶ done      (anything outbound: a draft, a reviewer, the owner)
                                         └──reject───▶ doing ──▶ review ──▶ waiting (the rework)
   done ──revise──▶ doing ──▶ done or waiting
   next · blocked · waiting ──cancel──▶ cancelled

   One policy for every path. A task typed into the bar, a routine firing, a handoff, a revision and
   an approval all go through claim() and execute(); whether the agent may send is decided by the
   task's needsOk (from the router, the routine or the handoff), never by which button started it.

   claim() checks the state and writes 'doing' in one synchronous step — no await between the read
   and the write — so two clicks, two tabs, or the page and the clock asking at once get exactly
   one run, and every other request is told it is already running.

   An approval is for ONE draft: the text and its hash are frozen into task.approval when the owner
   ticks it. A new draft (a rework) gets a new hash and needs a new tick; an approve request that
   names an older draft is refused. If the send fails, what happens next depends on whether the
   agent had started calling a tool: if not, nothing can have gone out and the draft goes back to
   waiting; if it had, the outcome is UNKNOWN — the task says so and is never retried automatically.

   Every change of state is written into task.history with its reason (coordinator.stampHistory). */
const hash = text => crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 16);
const modeFor = t => t.needsOk === false ? 'readonly' : 'draft'; // unknown = the safe side: draft, and wait for the OK
const ACTIONS = { run: ['next'], revise: ['done'], approve: ['waiting'], reject: ['waiting'] };
const RUNNING = ['doing', 'review'];
// the owner's pause: nothing new starts — no routine, no queued task, no run, no approval — until resumed
const OFFICE_FILE = path.join(DATA, 'office.json');
let office = (() => { try { return readJSON(OFFICE_FILE, {}); } catch { return {}; } })();
const pausedNow = () => office.paused ? { paused: true, at: office.pausedAt, why: office.pausedWhy || '' } : null;
// Unproven seats are limited, not just labelled: outbound work (a send, a post, a payment) from a seat
// below the required readiness level cannot be approved without the owner's explicit override, which
// is recorded on the approval. Drafting is never limited. office.config.json → readiness.requireForOutbound:
// none · briefed · contracted (default) · tested.
const READINESS_ORDER = ['generic', 'briefed', 'contracted', 'tested'];
const REQUIRED_FOR_OUTBOUND = (() => { const v = String(process.env.AO_REQUIRE_FOR_OUTBOUND || cfg.readiness?.requireForOutbound || 'contracted').toLowerCase(); return v === 'none' || READINESS_ORDER.includes(v) ? v : 'contracted'; })();
function seatLevel(agentId) {
  const a = AGENTS.find(x => x.id === agentId); if (!a) return 'generic';
  try { return coverageMod.coverage({ agents: [a], skills, brainPath: BRAIN }).list[0].level; } catch { return 'generic'; }
}
const seatLimited = agentId => REQUIRED_FOR_OUTBOUND !== 'none' && READINESS_ORDER.indexOf(seatLevel(agentId)) < READINESS_ORDER.indexOf(REQUIRED_FOR_OUTBOUND);
function claim(id, action, { waitingAt, override } = {}) {
  if (office.paused) return { status: 423, error: `the office is paused${office.pausedWhy ? ' (' + office.pausedWhy + ')' : ''} — resume it to start or approve work` };
  const list = load(); const t = list.find(x => x.id === id);
  if (!t) return { status: 404, error: 'no such task' };
  if (!ACTIONS[action].includes(t.state)) {
    const why = RUNNING.includes(t.state) ? 'this task is already running — nothing new was started'
      : t.state === 'blocked' ? `this task is blocked — ${t.blockedReason || 'its prerequisites are not finished'}`
      : t.state === 'cancelled' ? 'this task was cancelled'
      : action === 'approve' || action === 'reject' ? 'this task is not waiting for your OK' : `a task that is ${t.state} cannot be ${action === 'run' ? 'run' : 'revised'}`;
    return { status: 409, error: why, task: t };
  }
  if (action === 'revise' && t.needsCheck) return { status: 409, error: 'the last send has an unknown outcome — check whether it went out before changing this task', task: t };
  if (action === 'revise' && t.error) return { status: 409, error: 'this task failed — there is no result to revise', task: t };
  if (['run', 'revise', 'reject'].includes(action) && coord.overBudget(t)) return { status: 409, error: `this task has used its budget ($${coord.spent(t)} of $${t.budget.usd}) — raise it (POST /api/tasks/${t.id}/plan) or cancel the task`, task: t }; // approving an existing draft stays the owner's call
  if (action === 'approve') {
    if (waitingAt !== undefined && waitingAt !== null && +waitingAt !== t.waitingAt) return { status: 409, error: 'the draft changed since you opened it — read the new one before approving', task: t };
    if (seatLimited(t.agent) && !(override && override.approvedBy === 'owner' && String(override.reason || '').trim())) {
      return { status: 409, error: `${agentName(t.agent)} is "${seatLevel(t.agent)}": outbound work is limited to seats that are at least "${REQUIRED_FOR_OUTBOUND}". Nothing was sent. To send anyway, approve with {"override": {"approvedBy": "owner", "reason": "…"}}.`, task: t, limited: true };
    }
    if (!t.draft || hash(t.draft) !== t.draftHash) return { status: 409, error: 'the draft was edited after it was written — send it back for rework rather than approving an unchecked text', task: t };
  }
  const at = { id: nid(), action, mode: action === 'approve' ? 'approve' : modeFor(t), startedAt: Date.now() };
  if (action === 'approve') { t.approval = { draft: t.draft, draftHash: t.draftHash, recipient: ((t.draft.match(/^[\s>*]*TO:\s*(.+)$/im) || [])[1] || '').trim() || null, approvedAt: at.startedAt, attempt: at.id, scope: 'send this draft once, as written', review: t.review ? { agent: t.review.agent, verdict: t.review.verdict } : null, seatLevel: seatLevel(t.agent), ...(seatLimited(t.agent) ? { override: { approvedBy: 'owner', reason: String(override.reason).trim().slice(0, 300), required: REQUIRED_FOR_OUTBOUND } } : {}) }; delete t.sendStartedAt; }
  t.attempts = [...(t.attempts || []), at]; t.attempt = at.id;
  t.state = 'doing'; t.startedAt = at.startedAt; delete t.ask; t.because = `${action} (attempt ${at.id})`;
  save(list);
  return { task: t, attempt: at };
}
// the clock's path: claim at the moment the queue reaches the task (the page may have started it first)
async function startQueued(id) {
  if (office.paused) return null; // stays next; resume queues it again
  { const w = load().find(t => t.id === id); if (w?.retryAt && w.retryAt > Date.now() + 1000) { setTimeout(() => enqueue(() => startQueued(id)), w.retryAt - Date.now()).unref(); return w; } } // a retry waits for its backoff, even after a restart
  const c = claim(id, 'run');
  if (c.error) { if (c.status !== 404 && !RUNNING.includes(c.task?.state)) console.warn(`  ${id}: ${c.error}`); return c.task || null; }
  return execute(id, c.attempt.id);
}
const serverRuns = t => t.by !== 'you'; // tasks from the bar are started by the page; everything else by the server's queue
function patchTask(id, fn) { const list = load(); const t = list.find(x => x.id === id); if (t && fn(t) !== false) save(list); }

// The independent reviewer: reads an outbound draft before the owner does. It never sends and it
// cannot approve — a FAIL is shown to the owner beside the draft, and a PASS is only a PASS.
const reviewerFor = t => {
  if (cfg.review?.outbound === false) return null;
  const r = AGENTS.find(a => a.id === (cfg.review?.outbound || 'qa'));
  return r && r.id !== t.agent ? r : null;
};
const CONTROL_LINE = /^[\s>*\-•]*(HANDOFF\s*(→|->|=>|to)|NEEDS OWNER\s*:|REASON\s*:)/i;
const withoutControlLines = text => String(text || '').split(/\r?\n/).filter(l => !CONTROL_LINE.test(l)).join('\n').trim();
async function reviewDraft(task, draft, attemptId) {
  const r = reviewerFor(task); if (!r) return null;
  patchTask(task.id, t => { if (t.attempt !== attemptId) return false; t.state = 'review'; t.because = `${r.name} is reviewing the draft`; });
  const index = vaultIndex();
  const system = `You are ${r.name}, ${r.role}, at ${cfg.name}. You check another agent's outbound draft BEFORE the owner reads it. You never send, change or approve anything.\n` +
    'Check, against the company notes below only:\n- every price, figure, client, result or claim is supported by a note (prices only from offer-ladder); nothing is invented or implied (no track record we do not have)\n- it does what the owner asked, for the right recipient, and says what will go out\n- nothing promises a policy, term or date the notes call "not established"\n- tone follows the house style\n' +
    'Answer with the first line exactly "VERDICT: PASS" or "VERDICT: FAIL", then at most 6 short bullets, each quoting the exact words that are wrong and saying why. No other preamble.\n\n' +
    `${NOTES_HEADER}\n\n${businessContext(index)}`;
  const user = `Task: ${task.title}\nOwner's request: ${task.text}\nAuthor: ${agentName(task.agent)}\n\nDRAFT TO CHECK:\n${draft}`;
  const at = Date.now();
  try {
    const v = coord.parseVerdict(await ask(system, user, { maxTokens: 900, model: 'sonnet' }));
    return { agent: r.id, verdict: v.verdict, notes: v.notes, at, draftHash: hash(draft) };
  } catch (e) { return { agent: r.id, verdict: 'NOT REVIEWED', notes: 'The review could not run: ' + e.message, at, draftHash: hash(draft) }; }
}

// A finished result can hand work to another agent and ask the owner questions (coordinator.parseRequests).
function followUps(list, t, text) {
  const req = coord.parseRequests(text, AGENTS.map(a => a.id));
  const made = [];
  if (req.owner.length) t.needsOwner = [...(t.needsOwner || []), ...req.owner.map(q => ({ text: q, at: Date.now() }))];
  const depth = (t.depth || 0) + 1;
  if (req.handoffs.length && depth > coord.MAX_DEPTH) req.refused.push(`handoffs deeper than ${coord.MAX_DEPTH} levels are not created`);
  else for (const h of req.handoffs) {
    const a = AGENTS.find(x => x.id === h.agent);
    const task = { id: nid(), dept: a.department, agent: a.id, title: h.text.split(/(?<=[.!?])\s/)[0].slice(0, 90), text: h.text, plan: [], eta: 15, why: `handed off by ${agentName(t.agent)}`,
      state: 'next', addedAt: Date.now(), by: 'handoff', from: t.id, goal: t.goal || t.id, after: [t.id], depth, needsOk: routines.guessNeedsOk(h.text), because: `handed off by ${agentName(t.agent)} from "${t.title}"` };
    list.push(task); made.push(task);
  }
  if (req.refused.length) t.handoffsRefused = req.refused;
  return made;
}
function afterChange(list) { // re-check what was waiting on this; queue what can now run on the server
  const started = coord.unblock(list);
  return started.map(id => list.find(t => t.id === id)).filter(serverRuns);
}

async function execute(id, attemptId, { feedback } = {}) {
  const snap = load().find(t => t.id === id);
  const at = snap?.attempts?.find(a => a.id === attemptId);
  if (!snap || !at || snap.attempt !== attemptId) return snap || null;
  let out = null, failure = null, sendMarked = false, review = null;
  // the first tool call of an approved send is written to disk as it happens: after a crash, that is
  // the difference between "nothing went out" and "it may have gone out"
  const onToolUse = at.mode === 'approve' ? () => { if (sendMarked) return; sendMarked = true; patchTask(id, t => { if (t.attempt !== attemptId) return false; t.sendStartedAt = Date.now(); }); } : null;
  try { out = await run(snap, feedback, at.mode, { onToolUse }); } catch (e) { failure = e; }
  if (stopping) return null; // stopped on purpose: the run was cut off, not failed — the next start recovers it
  // "NOTHING TO SEND" on the first line: the agent looked and there is nothing outbound — a finished
  // report, never an approval request that makes an empty check look like work to send
  const noop = !!(out && at.mode === 'draft' && /^[\s#*_>]*NOTHING TO SEND\b/i.test(out.result));
  if (out && at.mode === 'draft' && !noop) review = await reviewDraft(snap, out.result, attemptId);

  const list = load(); const t = list.find(x => x.id === id);
  if (!t) { console.log(`  ${id} was deleted while it ran — its result was dropped`); return null; }
  if (t.attempt !== attemptId) return t;
  const a = t.attempts.find(x => x.id === attemptId); a.endedAt = Date.now(); delete t.attempt;
  let made = [];
  if (out) {
    a.outcome = 'ok';
    Object.assign(a, { costUSD: out.costUSD, tokens: out.tokens }); // what this attempt cost, for budgets and the per-role measures
    Object.assign(t, { read: out.read, sources: out.sources, tools: [...new Set([...(t.tools || []), ...out.tools])], used: [...new Set([...(t.used || []), ...out.used])], blocked: out.blocked, skills: out.skills, error: false, modelUsed: out.modelUsed, modelFrom: out.modelFrom, modelId: out.modelId, effortUsed: out.effortUsed, effortFrom: out.effortFrom });
    delete t.lastError;
    if (at.mode === 'approve') { t.result = t.approval.draft + '\n\n---\nAFTER YOUR OK\n' + out.result; t.approved = true; t.approvedAt = t.approval.approvedAt; t.state = 'done'; t.doneAt = Date.now(); t.because = 'sent after the owner approved'; made = followUps(list, t, t.approval.draft); }
    else if (noop) { Object.assign(t, { result: out.result, state: 'done', doneAt: Date.now(), noop: true, because: 'checked: nothing to send' }); made = followUps(list, t, out.result); }
    else if (at.mode === 'draft') {
      Object.assign(t, { result: out.result, draft: out.result, draftHash: hash(out.result), waitingAt: Date.now(), state: 'waiting', because: review ? `drafted; ${agentName(review.agent)}: ${review.verdict}` : 'drafted' });
      if (review) t.review = review; else delete t.review;
      t.ask = review && review.verdict !== 'PASS'
        ? `"${t.title}" is ready, but ${agentName(review.agent)} ${review.verdict === 'FAIL' ? 'FAILED it' : 'could not check it'}: ${(review.notes.split('\n').find(l => l.trim()) || '').replace(/^[-•*\s]+/, '').slice(0, 160)}. Read the review before you approve.`
        : routines.askLine(t) + (review ? ` ${agentName(review.agent)} checked it: PASS.` : '');
    }
    else { t.result = out.result; t.state = 'done'; t.doneAt = Date.now(); t.because = 'finished'; made = followUps(list, t, out.result); }
  } else {
    Object.assign(a, { outcome: 'error', error: failure.message, phase: failure.phase || '', cause: ops.causeOf(failure.message, failure.phase), costUSD: failure.cost ?? null });
    t.lastError = failure.message;
    if (at.mode === 'approve' && !failure.toolsAttempted && !t.sendStartedAt) {
      a.outcome = 'not-sent'; // the agent never reached a tool, so nothing left this machine; the approval is spent
      Object.assign(t, { state: 'waiting', waitingAt: Date.now(), error: false, because: 'send never started', ask: `"${t.title}" was approved but the send never started (${failure.message}). Nothing went out. Approve again to retry, or reject to change it.` });
      delete t.approval;
    } else if (at.mode === 'approve') {
      a.outcome = 'unknown';
      Object.assign(t, { state: 'done', doneAt: Date.now(), error: true, needsCheck: true, because: 'send outcome unknown',
        result: t.approval.draft + `\n\n---\nAFTER YOUR OK — OUTCOME UNKNOWN\nThe agent started the send and then stopped reporting (${failure.message}). It may have gone out, in part or in full. It has NOT been retried and will not be. Check the connector (the sent folder, the post, the record) before doing anything else with this.` + (failure.partial ? `\n\nThe agent's last words:\n${failure.partial}` : '') });
    } else if (at.action === 'reject' && t.draft) {
      Object.assign(t, { state: 'waiting', waitingAt: Date.now(), error: false, because: 'rework failed', ask: `The rework of "${t.title}" failed (${failure.message}). The previous draft is still here — approve it as it is, or reject again.` });
    } else if (at.mode === 'readonly' && serverRuns(t) && ['network', 'rate-limit'].includes(a.cause) && t.attempts.length < MAX_ATTEMPTS) {
      const wait = RETRY_BASE * 4 ** (t.attempts.length - 1); // 1, then 4 minutes: read-only work only — nothing outbound is ever retried
      Object.assign(t, { state: 'next', retryAt: Date.now() + wait, because: `${a.cause} failure — retry ${t.attempts.length} of ${MAX_ATTEMPTS - 1} in ${Math.round(wait / 1000)} s` });
      setTimeout(() => enqueue(() => startQueued(t.id)), wait).unref();
    } else if (at.action === 'revise') {
      Object.assign(t, { state: 'done', error: false, because: 'revision failed' }); // the previous result stands; the failed revision is in lastError and the attempt
    } else {
      Object.assign(t, { state: 'done', doneAt: Date.now(), error: true, because: 'failed: ' + failure.message.slice(0, 120), result: 'Could not complete this task: ' + failure.message + (failure.partial ? `\n\nPartial output — NOT a finished result:\n${failure.partial}` : '') });
    }
  }
  // Filing is not the work. A note that fails to save must not turn a finished task — least of all
  // a send that went out — into a failed task someone might run again.
  if (t.state === 'done' && !t.error) {
    try { t.note = writeNote(t); t.filed = 'ok'; delete t.noteError; }
    catch (e) { t.filed = 'failed'; t.noteError = e.message; console.warn(`  ⚠ ${t.id}: the work is done but the note could not be saved: ${e.message}`); }
  }
  const runnable = afterChange(list);
  save(list);
  for (const n of made) console.log(`  ↳ handoff ${n.id} → ${n.agent}: ${n.title}`);
  for (const n of [...made, ...runnable]) enqueue(() => startQueued(n.id)); // a handoff starts as next (its prerequisite just finished); the queue takes it
  if (t.pipeline) pipelineSync();
  if (t.research) researchSync();
  if (t.filed === 'ok' && t.state === 'done') await rebuildGraph();
  const tag = t.needsCheck ? '? outcome unknown' : t.error ? '✗ failed' : t.state === 'waiting' ? `⏸ waiting for your OK${t.review ? ' (review: ' + t.review.verdict + ')' : ''}` : a.outcome === 'error' ? '✗ revision failed, previous result kept' : '✓ done';
  console.log(`${tag.slice(0, 1)} ${t.id} ${tag.slice(2)} (${a.action}/${a.mode}${failure ? ': ' + failure.message.slice(0, 160) : ''}${t.tools?.length ? ', tools: ' + t.tools.join(' ') : ''}${t.note && t.filed === 'ok' && !failure ? ', note: ' + t.note : ''})`);
  return t;
}

/* ---------- the owner's controls over tasks (Phase 7) ---------- */
// A deadline (a date or a timestamp) and a budget in USD, as the owner sets them. Invalid values are
// refused rather than guessed; absent means none.
function planFields(b) {
  const out = {}, problems = [];
  if (b.deadline !== undefined && b.deadline !== null && b.deadline !== '') { const at = typeof b.deadline === 'number' ? b.deadline : Date.parse(b.deadline); if (Number.isFinite(at)) out.deadline = at; else problems.push('deadline is not a date'); }
  if (b.budget !== undefined && b.budget !== null) { const usd = Number(b.budget?.usd ?? b.budget); if (Number.isFinite(usd) && usd > 0) out.budget = { usd }; else problems.push('budget must be a positive number of USD'); }
  return { fields: out, problems };
}
function newTask({ dept, agent, title, text, needsOk, after = [], goal, by = 'you', plan = [], why = '', model, effort, pipeline, extra = {} }) {
  const list = load();
  const known = after.filter(id => list.some(t => t.id === id));
  const task = { id: nid(), dept, agent, title, text, plan, eta: 15, why, needsOk, state: coord.initialState(known, list), addedAt: Date.now(), by, ...(known.length ? { after: known } : {}), ...(goal ? { goal } : {}), ...(pipeline ? { pipeline } : {}), ...extra, model, effort, because: known.length ? `created; waits for ${known.length} task${known.length > 1 ? 's' : ''}` : 'created' };
  list.push(task); coord.unblock(list); save(list);
  if (task.state === 'next' && serverRuns(task)) enqueue(() => startQueued(task.id));
  return list.find(t => t.id === task.id);
}
function ownerAction(id, verb, b) {
  const list = load(); const t = list.find(x => x.id === id);
  if (!t) return { status: 404, error: 'no such task' };
  const note = String(b.why || b.note || '').trim().slice(0, 300);
  if (verb === 'cancel') {
    if (!['next', 'blocked', 'waiting'].includes(t.state)) return { status: 409, error: RUNNING.includes(t.state) ? 'it is running — cancel it when it stops' : `a task that is ${t.state} cannot be cancelled` };
    Object.assign(t, { state: 'cancelled', cancelledAt: Date.now(), because: 'cancelled by the owner' + (note ? ': ' + note : '') }); delete t.ask;
  } else if (verb === 'reassign') {
    const a = AGENTS.find(x => x.id === b.agent);
    if (!a) return { status: 400, error: 'no such agent' };
    if (!['next', 'blocked'].includes(t.state)) return { status: 409, error: 'only work that has not started can be reassigned' };
    t.reassigned = [...(t.reassigned || []), { from: t.agent, to: a.id, at: Date.now(), why: note }];
    Object.assign(t, { agent: a.id, dept: a.department });
    t.history = [...(t.history || []), { at: Date.now(), from: t.state, to: t.state, why: `reassigned to ${a.name}${note ? ': ' + note : ''}` }];
  } else if (verb === 'checked') { // reconcile an unknown outcome: the owner looked and says whether it went out
    if (!t.needsCheck) return { status: 409, error: 'this task has no unknown outcome to check' };
    if (typeof b.sent !== 'boolean') return { status: 400, error: 'say whether it went out: {"sent": true} or {"sent": false}' };
    t.reconciled = { sent: b.sent, note, at: Date.now() }; t.needsCheck = false;
    if (b.sent) Object.assign(t, { error: false, approved: true, because: 'owner confirmed it went out' + (note ? ': ' + note : '') });
    else { Object.assign(t, { state: 'waiting', error: false, waitingAt: Date.now(), result: t.draft, because: 'owner confirmed it did not go out', ask: `"${t.title}" did not go out (you checked). Approve again to send it, or reject to change it.` }); delete t.approval; }
  } else if (verb === 'plan') { // the owner sets or moves a deadline, or sets or raises a budget
    const p = planFields(b); if (p.problems.length) return { status: 400, error: p.problems.join('; ') };
    if (!Object.keys(p.fields).length) return { status: 400, error: 'send a deadline and/or a budget' };
    t.history = [...(t.history || []), { at: Date.now(), from: t.state, to: t.state, why: `plan changed by the owner: ${p.fields.deadline ? 'deadline ' + new Date(p.fields.deadline).toISOString().slice(0, 10) : ''}${p.fields.deadline && p.fields.budget ? ', ' : ''}${p.fields.budget ? 'budget $' + p.fields.budget.usd : ''}${note ? ' — ' + note : ''}` }];
    Object.assign(t, p.fields);
  } else if (verb === 'answer') { // an agent's NEEDS OWNER question, answered: the agent picks the work up again with the answer
    const q = (t.needsOwner || []).filter(x => !x.answered)[+b.index || 0];
    const answer = String(b.text || '').trim();
    if (!q) return { status: 409, error: 'no open question on this task' };
    if (!answer) return { status: 400, error: 'empty answer' };
    Object.assign(q, { answered: true, answer, answeredAt: Date.now() });
    save(list);
    const follow = newTask({ dept: t.dept, agent: t.agent, title: `${t.title} — with your answer`.slice(0, 90), text: `${t.text}\n\nYou asked the owner: "${q.text}"\nThe owner answered: "${answer}"\nYour previous result:\n${String(t.result || '').slice(0, 3000)}`, needsOk: t.needsOk, goal: t.goal || t.id, by: 'answer' });
    return { task: t, follow };
  } else return { status: 400, error: 'unknown action' };
  const runnable = afterChange(list); save(list);
  if (t.pipeline) pipelineSync();
  for (const n of runnable) enqueue(() => startQueued(n.id));
  return { task: list.find(x => x.id === id) };
}
function setPaused(paused, why) {
  office = paused ? { ...office, paused: true, pausedAt: Date.now(), pausedWhy: String(why || '').slice(0, 200) } : { ...office, paused: false, resumedAt: Date.now() };
  writeJSON(OFFICE_FILE, office);
  console.log(paused ? `⏸ office PAUSED${office.pausedWhy ? ': ' + office.pausedWhy : ''} — nothing new starts` : '▶ office resumed');
  if (!paused) for (const t of load().filter(t => t.state === 'next' && serverRuns(t))) enqueue(() => startQueued(t.id));
  return pausedNow();
}

/* ---------- the first-client acquisition workflow (Phase 6, acquisition.mjs) ---------- */
// Keep data/pipeline.json in step with every task that belongs to it, then let the workflow take
// its next steps. Every step it takes is an ordinary task: claimed, reviewed, approved, recorded.
function pipelineSync() {
  let pipe, tasks; try { pipe = acq.loadPipeline(DATA); tasks = load(); } catch (e) { console.warn('  ✗ pipeline:', e.message); return; } // a damaged store is reported by the API, never a crash here
  const runs = [];
  for (const t of tasks.filter(t => t.pipeline)) { const r = acq.recordTask(pipe, t); if (r) runs.push(r); }
  if (!runs.length) return;
  acq.savePipeline(DATA, pipe);
  for (const r of runs) if (r.noop || r.problem || r.accepted !== undefined) console.log(`  ◇ pipeline ${r.step}: ${r.noop || r.problem || `${r.accepted} accepted, ${(r.rejected || []).length} rejected`}`);
  pipelineAdvance();
}
function pipelineAdvance() {
  const constraints = acq.loadConstraints(BRAIN);
  if (office.paused) return { created: [], noop: 'The office is paused.' };
  let pipe, open; try { pipe = acq.loadPipeline(DATA); open = load().filter(t => t.pipeline && !coord.TERMINAL.includes(t.state)); } catch (e) { return { created: [], noop: 'The state files are damaged: ' + e.message }; }
  const { actions, noop } = acq.plan(pipe, constraints, open);
  const created = [];
  for (const a of actions) {
    const spec = acq.taskFor(a, pipe, { exclude: pipe.prospects.map(p => p.key), config: constraints.config });
    const agent = AGENTS.find(x => x.id === spec.agent);
    if (!agent) { console.warn(`  ✗ pipeline: no agent ${spec.agent} on the roster for ${a.step}`); continue; }
    const t = newTask({ dept: agent.department, agent: agent.id, title: spec.title, text: spec.text, needsOk: spec.needsOk, by: 'pipeline', goal: 'first-client', why: `acquisition workflow: ${a.step}`,
      pipeline: { step: a.step, ...(a.key ? { key: a.key } : {}), ...(a.keys ? { keys: a.keys } : {}) } });
    if (a.step === 'qualify') for (const k of a.keys) { const p = pipe.prospects.find(x => x.key === k); if (p) p.qualifyTask = t.id; }
    created.push({ id: t.id, step: a.step, agent: agent.id, title: t.title });
    console.log(`  ◆ pipeline ${a.step} → ${agent.id}: ${t.title}`);
  }
  if (actions.some(a => a.step === 'qualify')) acq.savePipeline(DATA, pipe);
  return { created, noop };
}
function pipelineMark(key, event, note) {
  const pipe = acq.loadPipeline(DATA);
  const r = acq.mark(pipe, key, event, note);
  if (r.error) return r;
  acq.savePipeline(DATA, pipe);
  console.log(`  ◇ pipeline ${key}: ${event}${note ? ' — ' + note : ''}`);
  let task = null;
  if (r.action) { // interested → a proposal draft; signed → a delivery plan
    const spec = acq.taskFor(r.action, pipe, { config: acq.loadConstraints(BRAIN).config }); const agent = AGENTS.find(x => x.id === spec.agent);
    if (agent && !office.paused) task = newTask({ dept: agent.department, agent: agent.id, title: spec.title, text: spec.text, needsOk: spec.needsOk, by: 'pipeline', goal: 'first-client', why: `acquisition workflow: ${r.action.step}`, pipeline: { step: r.action.step, key } });
  }
  return { prospect: r.prospect, task };
}
/* ---------- regular industry learning (Phase 5, research.mjs) ---------- */
function researchSync() {
  let st, tasks; try { st = research.loadState(DATA); tasks = load(); } catch (e) { console.warn('  ✗ research:', e.message); return; }
  const cfg2 = research.loadConfig(BRAIN), ids = AGENTS.map(a => a.id);
  let changed = false;
  for (const t of tasks.filter(t => t.research)) { const r = research.recordTask(st, t, { config: cfg2.config, agentIds: ids }); if (r) { changed = true; console.log(`  ◇ research ${t.id}: ${r.outcome === 'gap' ? 'GAP — ' + r.gap : r.outcome === 'ok' ? `${r.accepted} accepted, ${r.stale} stale, ${r.blocked} blocked, ${r.rejected.length} rejected, ${r.duplicates} duplicate` : r.outcome}`); } }
  if (changed) research.saveState(DATA, st);
}
function researchRun({ by = 'you', focus = null } = {}) {
  const c = research.loadConfig(BRAIN);
  if (c.missing.length) return { status: 409, error: `research is not configured: ${c.missing.join(', ')} not set in ${c.file}. Budget and topics are the owner's to set.` };
  if (office.paused) return { status: 423, error: 'the office is paused' };
  let st; try { st = research.loadState(DATA); } catch (e) { return { status: 500, error: e.message }; }
  const b = research.budget(st, c.config);
  if (b.left <= 0) return { status: 429, error: `this week's research budget is spent (${b.used} of ${b.limit} runs) — it resets on Monday` };
  if (load().some(t => t.research && !coord.TERMINAL.includes(t.state))) return { status: 409, error: 'a research run is already open' };
  const spec = research.taskFor(c.config, st, { focus }); const agent = AGENTS.find(x => x.id === spec.agent);
  if (!agent) return { status: 500, error: `no ${spec.agent} agent on the roster` };
  const why = by === 'clock' ? 'the weekly research run' : by === 'watch' ? `a watched page changed: ${focus?.url}` : 'research run started by the owner';
  const t = newTask({ dept: agent.department, agent: agent.id, title: spec.title, text: spec.text, needsOk: false, by: 'research', why, extra: { research: true, ...(focus ? { researchFocus: focus.id } : {}) } });
  st.runs.push({ taskId: t.id, startedAt: t.addedAt, by, ...(focus ? { focus: focus.id } : {}) }); research.saveState(DATA, st);
  console.log(`  ◆ research run ${t.id}${focus ? ' (' + focus.id + ' changed)' : ''} (${b.used + 1} of ${b.limit} this week)`);
  return { task: t, budget: { ...b, used: b.used + 1, left: b.left - 1 } };
}
// Watched pages: fetch, strip to text, hash. A changed page starts one focused run inside the budget;
// a change the budget cannot cover, and a page that cannot be fetched, are shown to the owner.
async function researchWatch({ manual = false } = {}) {
  const c = research.loadConfig(BRAIN);
  if (!manual && !c.active) return { skipped: 'research is not active' };
  let st; try { st = research.loadState(DATA); } catch (e) { return { error: e.message }; }
  const fetchText = async url => { const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'AgentsOffice-watch/1 (+local)' } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); };
  const { changed, failed } = await research.checkWatch(st, c.config, fetchText);
  const runs = [];
  for (const w of changed) {
    const r = researchRun({ by: 'watch', focus: w });
    const fresh = research.loadState(DATA); fresh.watch = { ...fresh.watch, ...st.watch };
    if (r.error) { fresh.watch[w.id].pendingChange = { at: w.changedAt, why: r.error }; console.log(`  ◇ watched page ${w.id} changed, no run: ${r.error}`); }
    else { delete fresh.watch[w.id].pendingChange; runs.push(r.task.id); }
    research.saveState(DATA, fresh); st = fresh;
  }
  if (!changed.length) research.saveState(DATA, { ...research.loadState(DATA), watch: st.watch });
  return { checked: (c.config.watch || []).length, changed: changed.map(w => w.id), failed: failed.map(w => ({ id: w.id, error: w.error })), runs };
}
let lastResearchCheck = 0, lastWatchCheck = 0;
function researchClock(now = Date.now()) { // weekly, on the owner's day and time, inside the owner's budget; watched pages every watchEveryHours
  if (now - lastResearchCheck < 5 * 60 * 1000) return; lastResearchCheck = now;
  const c = research.loadConfig(BRAIN); if (!c.active) return;
  if (now - lastWatchCheck > (Number(c.config.watchEveryHours) || 24) * 3600e3) { lastWatchCheck = now; researchWatch().catch(e => console.warn('  research watch:', e.message)); }
  const d = new Date(now), [hh, mm] = String(c.config.at || '08:00').split(':').map(Number);
  if (d.getDay() !== Number(c.config.day ?? 1) || d.getHours() * 60 + d.getMinutes() < hh * 60 + (mm || 0)) return;
  let st; try { st = research.loadState(DATA); } catch { return; }
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (st.runs.some(r => r.startedAt >= today && r.by !== 'watch')) return;
  const r = researchRun({ by: 'clock' }); if (r.error) console.log(`  ◇ research not run: ${r.error}`);
}
const skillRoles = name => { const s = skills.summary().skills.find(x => x.name === name); if (!s) return []; return AGENTS.filter(a => s.everyone || s.agents.includes(a.id) || s.departments.includes(a.department)).map(a => a.id); };
function lessonDecisions() { // corrections waiting to become rules, and rules due a second look
  const items = [];
  for (const a of AGENTS) {
    let l; try { l = learn.read(BRAIN, a.id); } catch { continue; }
    const plain = line => line.replace(/^\d{4}-\d{2}-\d{2}\s*·\s*/, '').replace(/\s*←.*$/, '');
    l.proposed.forEach((line, i) => items.push({ kind: 'proposed-rule', agent: a.id, index: i, decision: `${a.name}: make this a standing rule? "${plain(line)}"${/⚠/.test(line) ? ' — ' + line.slice(line.indexOf('⚠') + 1).trim() : ''}` }));
    for (const r of l.reviewDue) items.push({ kind: 'rule-review', agent: a.id, decision: `${a.name}'s rule is over six months old — is it still right? "${plain(r)}"` });
  }
  return items;
}
function researchDecisions() {
  const items = []; let st; try { st = research.loadState(DATA); } catch { return items; }
  for (const r of st.runs.filter(r => r.outcome === 'gap' && Date.now() - (r.endedAt || 0) < 7 * 864e5)) items.push({ kind: 'research-gap', id: r.taskId, decision: 'The research run left a gap: ' + r.gap + '.' });
  for (const [id, w] of Object.entries(st.watch || {})) {
    if (w.lastError) items.push({ kind: 'research-gap', key: id, decision: `The watched page "${id}" (${w.url}) could not be checked: ${w.lastError}. Changes to it are not being seen.` });
    if (w.pendingChange) items.push({ kind: 'research-watch', key: id, decision: `The watched page "${id}" changed on ${new Date(w.pendingChange.at).toISOString().slice(0, 10)} but was not researched: ${w.pendingChange.why}.` });
  }
  try { for (const e of research.ruleEffect(st, { brainPath: BRAIN, rolesOf: skillRoles })) {
    if (e.verdict === 'regressed') items.push({ kind: 'rule-regressed', key: e.skill, decision: `The research rule published to "${e.skill}" (v${e.version}) made its seats' test results worse (${e.roles.filter(r => r.verdict === 'regressed').map(r => `${r.role} ${Math.round(r.before * 100)}% → ${Math.round(r.after * 100)}%`).join(', ')}). Roll it back: POST /api/research/rollback {"skill": "${e.skill}"}.` });
    else if (e.verdict === 'not measured' && Date.now() - e.at > 864e5) items.push({ kind: 'rule-unmeasured', key: e.skill, decision: `The research rule published to "${e.skill}" has not been measured: run the fixtures for ${e.roles.map(r => r.role).slice(0, 5).join(', ') || 'its seats'} (node fixtures.mjs <id>) to see whether it helped.` });
  } } catch {}
  for (const x of st.findings.filter(x => x.status === 'blocked')) items.push({ kind: 'research-blocked', key: x.key, decision: 'Research found something that would change a price, permission, contract or commitment: "' + x.claim.slice(0, 160) + '" (' + x.publisher + ', ' + x.sourceUrl + '). Proposed: ' + x.proposedAction + '. That is your decision; research cannot make it.' });
  return items;
}
function pipelineDecisions() { // for /api/pending: what the workflow needs from the owner
  const c = acq.loadConstraints(BRAIN), items = [];
  if (!c.active) items.push({ kind: 'acquisition-constraints', decision: c.missing.length ? `Set the acquisition limits in ${c.file}: ${c.missing.map(k => `${k} — ${acq.CONSTRAINTS[k]}`).join('; ')}. Then set "active": true. Until then the workflow starts nothing.` : `Set "active": true in ${c.file} to start the acquisition workflow.` });
  let pipe; try { pipe = acq.loadPipeline(DATA); } catch { return items; }
  for (const p of pipe.prospects.filter(p => p.stage === 'needs-review')) items.push({ kind: 'prospect-review', key: p.key, title: p.company, decision: `Review prospect ${p.company}: ${p.history?.at(-1)?.why || 'fit unclear'}. Mark it qualified or disqualified.` });
  for (const p of pipe.prospects.filter(p => p.stage === 'unknown')) items.push({ kind: 'prospect-unknown', key: p.key, title: p.company, decision: `Check whether the message to ${p.company} went out, then mark the task checked.` });
  return items;
}

// After a crash, a restart or a sleep, the queue in memory is gone. Nothing that was mid-flight is
// silently dropped, and nothing that might have sent something is silently repeated.
function recoverTasks() {
  let list; try { list = load(); } catch (e) { console.error('  ✗ tasks:', e.message); return; }
  let changed = false; const requeue = [], notes = [];
  for (const t of list) {
    if (t.state === 'waiting' && t.draft && !t.draftHash) { t.draftHash = hash(t.draft); t.waitingAt = t.waitingAt || Date.now(); changed = true; } // drafts from before approvals were tied to their text
    if (t.state === 'next' && serverRuns(t)) { requeue.push(t.id); continue; }
    if (!RUNNING.includes(t.state)) continue;
    changed = true;
    const at = (t.attempts || []).find(x => x.id === t.attempt);
    if (at) Object.assign(at, { endedAt: Date.now(), outcome: 'interrupted' });
    delete t.attempt;
    const action = at ? at.action : t.draft ? 'approve' : 'run'; // before attempts were recorded: a draft in flight may have been a send
    t.because = 'interrupted by a restart';
    if (action === 'approve' && at && !t.sendStartedAt) {
      Object.assign(t, { state: 'waiting', waitingAt: Date.now(), ask: `The office restarted before "${t.title}" was sent. Nothing went out. Approve again to send it.` });
      delete t.approval; notes.push(`${t.id} back to waiting (restart before the send)`);
    } else if (action === 'approve') {
      Object.assign(t, { state: 'done', doneAt: Date.now(), error: true, needsCheck: true,
        result: (t.approval?.draft || t.draft || '') + '\n\n---\nAFTER YOUR OK — OUTCOME UNKNOWN\nThe office stopped while this send was in progress. It may have gone out. It has NOT been retried. Check the connector before doing anything else with this.' });
      notes.push(`${t.id} OUTCOME UNKNOWN (restart during a send)`);
    } else if (action === 'reject') {
      Object.assign(t, { state: 'waiting', waitingAt: Date.now(), ask: `The office restarted while "${t.title}" was being reworked. The previous draft is still here — approve it, or reject again.` });
      notes.push(`${t.id} back to waiting (rework interrupted)`);
    } else if (action === 'revise') {
      Object.assign(t, { state: 'done', lastError: 'the revision was interrupted by a restart — ask for it again' });
      notes.push(`${t.id} revision interrupted, previous result kept`);
    } else if ((t.attempts || []).length >= MAX_ATTEMPTS) {
      Object.assign(t, { state: 'done', doneAt: Date.now(), error: true, result: `Could not complete this task: it was interrupted ${t.attempts.length} times and will not be started again automatically.` });
      notes.push(`${t.id} failed after ${t.attempts.length} interrupted attempts`);
    } else {
      t.state = 'next'; t.interrupted = (t.interrupted || 0) + 1;
      if (serverRuns(t)) requeue.push(t.id);
      notes.push(`${t.id} back to next (interrupted)`);
    }
  }
  const unblocked = afterChange(list); if (unblocked.length) changed = true;
  if (changed) save(list);
  for (const n of notes) console.log('  ↺ ' + n);
  for (const id of [...requeue, ...unblocked.map(t => t.id)]) enqueue(() => startQueued(id));
  if (requeue.length + unblocked.length) console.log(`  ↺ ${requeue.length + unblocked.length} task${requeue.length + unblocked.length > 1 ? 's' : ''} queued again`);
  if (office.paused) console.log(`  ⏸ the office is PAUSED${office.pausedWhy ? ' (' + office.pausedWhy + ')' : ''} — nothing starts until you resume`);
}
// The usage budget. A office of this size firing routines every morning can burn a whole Claude
// plan window before lunch, and the failure mode is silent: the plan runs out and work just stops.
// So the clock checks the gauge first and holds the timetable above a ceiling, telling you why.
// The work is not lost — a held routine stays due and fires once there is headroom again.
const USAGE_CEILING = Math.max(10, Math.min(100, +cfg.usageCeiling || 85)); // percent of the session window
let heldNotice = 0;
async function routinesHeld() {
  if (cfg.usageGuard === false) return false;             // opt out entirely in office.config.json
  try {
    const u = await getUsage(false);
    const pct = u && u.session && typeof u.session.percent === 'number' ? u.session.percent : null;
    if (pct === null) return false;                       // no gauge: never block the office on a guess
    if (pct < USAGE_CEILING) return false;
    if (Date.now() - heldNotice > 10 * 60 * 1000) {
      heldNotice = Date.now();
      console.warn(`  ⏸ routines held — Claude plan session at ${pct}% (ceiling ${USAGE_CEILING}%). ` +
        'They stay due and run once the window resets. Raise "usageCeiling" in office.config.json to change this.');
    }
    return true;
  } catch { return false; }
}
let lastPipelineTick = 0;
async function tickRoutines() {
  if (office.paused) return; // paused: routines stay due and fire once the owner resumes
  researchClock();
  let list; try { list = loadRoutines(); } catch (e) { console.warn('routines:', e.message); return; }
  const dueNow = routines.due(list, RSTATE);
  if (Date.now() - lastPipelineTick > 30 * 60 * 1000 && acq.loadConstraints(BRAIN).active && !(await routinesHeld())) { lastPipelineTick = Date.now(); pipelineAdvance(); } // the workflow's own heartbeat: every 30 min, only when active
  if (!dueNow.length) return;
  if (await routinesHeld()) return;                       // over budget: leave them due, try again later
  for (const { routine, due, late } of dueNow) fire(routine, { due, late });
}
const uniqueId = (base, list) => { let id = base || 'routine', n = 2; while (list.some(r => r.id === id)) id = `${base}-${n++}`; return id; };
function editRoutine(id, patch) { const r = rlist.routines.find(x => x.id === id); if (!r) return null; Object.assign(r, patch); routines.save(BRAIN, rlist.routines); return loadRoutines().find(x => x.id === id); }
function removeRoutine(id) { const n = rlist.routines.length; rlist.routines = rlist.routines.filter(x => x.id !== id); if (rlist.routines.length !== n) routines.save(BRAIN, rlist.routines); loadRoutines(); return rlist.routines.length !== n; }
// a sentence (or the REPEAT picker) → a routine in the brain file. Claude names the agent, the title and whether it needs the OK.
async function makeRoutine({ dept, text, when, agent, needsOk, model, effort }) {
  let taskText = String(text || '').trim(), w = when, parsed = null;
  if (!w) {
    parsed = parseWhen(taskText);
    if (!parsed) return { error: 'No schedule in that sentence. Say when: "every weekday at 8am, …", "Mondays 9am, …", "every hour 9-5, …".', noSchedule: true };
    if (parsed.needsDay) return { error: 'Which day? Say "every Monday …" or "Mon and Thu …".', needsDay: true };
    if (parsed.needsTime) return { error: 'What time? Say "… at 8am" or "… at 17:30".', needsTime: true };
    w = parsed.when; taskText = parsed.text;
  }
  if (!validWhen(w)) return { error: 'That schedule is not complete.' };
  if (!taskText) return { error: 'What should happen? The sentence has a time but no task.' };
  loadRoutines();
  const r = await route(dept, taskText);
  const a = agent && AGENTS.find(x => x.id === agent && x.department === dept) ? agent : r.agent;
  const v = routines.validate({ id: uniqueId(slug(r.title).slice(0, 40), rlist.routines), dept, agent: a, title: r.title, text: taskText, when: w, needsOk: typeof needsOk === 'boolean' ? needsOk : r.needsOk, plan: r.plan, model: normModel(model) || undefined, effort: normEffort(effort) || undefined }, AGENTS, rlist.routines);
  if (v.problems.length) return { error: v.problems.join('; ') };
  rlist.routines.push(v.routine); routines.save(BRAIN, rlist.routines);
  const out = loadRoutines().find(x => x.id === v.routine.id);
  console.log(`⏱ routine ${out.id} → ${out.agent}: ${out.title} (${out.desc} · next ${untilText(out.nextAt)}${out.needsOk ? ' · waits for the OK' : ''})`);
  return { ok: true, routine: out, why: r.why, guessed: parsed?.guessed ? parsed.guessWord : null };
}
// B2: a routine said to an agent in chat. The lead routes it inside the department; a specialist takes it on.
async function routinesChat(a, text) {
  const t = String(text).trim(), dept = a.department, allowed = routines.ALLOWED.includes(dept);
  if (/^\s*(routines?|schedule|timetable|what(?:'s| is) (?:scheduled|on the (?:schedule|timetable)))\s*\??\s*$/i.test(t)) return { reply: allowed ? routines.listText(loadRoutines(), dept, AGENTS) : routines.refusal(dept) };
  const cmd = /^\s*(pause|stop|resume|start|unpause|delete|remove|run)\b\s*(?:the\s+)?(.*?)\s*[.!]?$/i.exec(t);
  if (cmd && allowed && !parseWhen(t)) {
    const list = loadRoutines(); const words = cmd[2].replace(/\s+(routine|one)$/i, ''); const r = routines.matchRoutine(list, dept, words);
    if (!r) return { reply: (list.some(x => x.dept === dept) ? 'Which one? ' : '') + routines.listText(list, dept, AGENTS) };
    const verb = cmd[1].toLowerCase();
    if (verb === 'run') { const task = fire(r, { by: 'you' }); if (task.existing) return { reply: `"${r.title}" is already ${task.state === 'waiting' ? 'waiting for your OK' : 'running'} — I did not start it again.`, task }; return { reply: `Running "${r.title}" now — ${r.agent === a.id ? 'I have it' : agentName(r.agent) + ' has it'}. It lands in the panel${r.needsOk ? ' and waits for your OK before anything is sent' : ''}.`, task }; }
    if (/pause|stop/.test(verb)) { editRoutine(r.id, { paused: true }); return { reply: `Paused "${r.title}". It stays on the timetable; say "resume ${r.title.toLowerCase()}" to start it again.` }; }
    if (/resume|start|unpause/.test(verb)) { const n = editRoutine(r.id, { paused: false }); return { reply: `"${r.title}" is back on — next ${untilText(n.nextAt)}.` }; }
    if (/delete|remove/.test(verb)) { removeRoutine(r.id); return { reply: `Deleted "${r.title}". It is off the timetable.` }; }
  }
  const p = parseWhen(t);
  if (!p) return null;
  if (!allowed) return { reply: routines.refusal(dept) };
  if (p.needsDay) return { reply: 'Which day? Say it again with the day: "every Monday at 9am, …".' };
  if (p.needsTime) return { reply: `What time? Say it again with the time, e.g. "every weekday at 8am, ${p.text ? p.text.slice(0, 60) : '…'}".` };
  if (!p.text) return { reply: 'I have the time but not the task. Say it again with what should happen.' };
  const made = await makeRoutine({ dept, text: p.text, when: p.when, agent: a.lead ? undefined : a.id });
  if (made.error) return { reply: made.error };
  const r = made.routine, who = r.agent === a.id ? 'I have it' : `${agentName(r.agent)} has it`;
  return { reply: `Done. ${r.desc.charAt(0).toUpperCase() + r.desc.slice(1)}, ${who}.${made.guessed ? ` I took "${made.guessed}" as ${r.when.at}; say a time to change it.` : ''} ${r.needsOk ? 'Anything to send waits for your OK first.' : 'It only reads, so it will not wait for you.'} Next run ${untilText(r.nextAt)}. Say "routines" to see the list, "pause ${r.title.toLowerCase()}" to stop it.`, routine: r };
}

/* ---------- http ---------- */
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const body = req => new Promise((resolve, reject) => { let s = ''; req.on('data', d => { s += d; }); req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } }); });

await rebuildGraph();
{ const n = mcp.useCache(path.join(DATA, 'mcp-cache.json')); if (n) console.log(`  connectors: ${n} from the last discovery, while claude mcp list runs (it can take over a minute)`); }
const discovering = mcp.discover().then(l => { console.log(`  connectors: ${l.filter(s => s.status === 'connected').length} connected of ${l.length} (claude mcp list)`); if (!l.length) setTimeout(() => mcp.discover().then(r => console.log(`  connectors (retry): ${r.filter(s => s.status === 'connected').length} connected of ${r.length}`)), 5 * 60 * 1000).unref(); return l; });
const agentsOut = () => { const setup = setupMap(); return AGENTS.map(a => ({ id: a.id, name: a.name, role: a.role, does: a.does, tools: a.tools, brief: a.brief || '', model: a.model || '', effort: a.effort || '', skills: skills.names(a), lessons: learn.count(BRAIN, a.id), department: a.department, lead: a.lead,
  interviewer: leadOf(a.department).id === a.id, setUp: setup[a.department] })); };
// No login guards this API, and it can approve outbound sends. Two browser-borne attacks are shut:
// another website posting to it from a page the owner has open (a cross-origin request carries an
// Origin that is not this office), and DNS rebinding (a foreign hostname pointed at 127.0.0.1).
const LOOPBACK = /^(127\.0\.0\.1|localhost|::1)$/i.test(HOST);
function refused(req) {
  const host = String(req.headers.host || '');
  if (LOOPBACK && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host)) return 'unknown host';
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin) {
    let o; try { o = new URL(req.headers.origin).host; } catch { return 'bad origin'; }
    if (o !== host) return 'cross-site request';
  }
  return null;
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const no = refused(req); if (no) return json(res, 403, { error: 'refused: ' + no });
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/command-centre-v2.html' || url.pathname === '/dark')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      const page = fs.readFileSync(HTML, 'utf8');
      return res.end(url.pathname === '/dark' ? page.replace('<body>', '<body class="dark">') : page); // /dark: the same file, opened in dark mode
    }
    if (req.method === 'GET' && url.pathname === '/ops') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(fs.readFileSync(path.join(ROOT, 'ops.html'), 'utf8')); }
    if (url.pathname === '/api/ops') return json(res, 200, opsSummary());
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, instance: { pid: process.pid, startedAt: STARTED }, heartbeat: heartbeat.last, ready: readiness().ok, version, backend, model: cfg.model, modelName: modelName(cfg.model), models: MODEL_KEYS, effort: cfg.effort || '', efforts: EFFORT_KEYS, name: cfg.name, brain: BRAIN, notes: graph.notes, depts: DEPT_KEYS,
      agents: agentsOut(), setup: setupMap(), routines: (l => ({ count: l.length, paused: l.filter(r => r.paused).length, depts: routines.ALLOWED }))(loadRoutines()), roster: { customised: roster.customised, briefed: roster.briefed, files: roster.files, problems: roster.problems }, skills: (({ count, shipped, brain, problems }) => ({ count, shipped, brain, problems }))(skills.summary()), tools: backend === 'claude-cli', mcp: mcp.summary(), clock: CLOCK_ON, host: HOST, paused: pausedNow(), readiness: { requireForOutbound: REQUIRED_FOR_OUTBOUND } });
    if (url.pathname === '/api/agents') return json(res, 200, { agents: agentsOut(), problems: roster.problems, files: roster.files });
    if (url.pathname === '/api/skills') return json(res, 200, refreshSkills().summary()); // reloads from disk: edit a skill, hit this, see it
    const lm = url.pathname.match(/^\/api\/lessons\/([a-z0-9_-]+)\/(confirm|dismiss)$/);
    if (lm && req.method === 'POST') { const b = await body(req); const a = AGENTS.find(x => x.id === lm[1]); if (!a) return json(res, 404, { error: 'no such agent' });
      if (b.approvedBy !== 'owner') return json(res, 403, { error: 'only the owner turns a correction into a rule: send "approvedBy": "owner"' });
      const r = lm[2] === 'confirm' ? learn.confirm(BRAIN, a, +b.index || 0, { replaceConflicting: b.replaceConflicting === true }) : learn.dismiss(BRAIN, a, +b.index || 0);
      if (r.error) return json(res, 409, r); brainGit.snapshot(`lessons: ${a.name} ${lm[2]}`); return json(res, 200, { ok: true, ...r, lessons: learn.read(BRAIN, a.id) }); }
    if (url.pathname === '/api/lessons') return json(res, 200, { dir: learn.dir(BRAIN), agents: AGENTS.map(a => ({ id: a.id, name: a.name, ...learn.read(BRAIN, a.id) })).filter(x => x.rules.length || x.oneOffs.length) });
    if (url.pathname === '/api/mcp') { if (url.searchParams.get('refresh') === '1') await mcp.discover(); else if (!mcp.list().length) await discovering; /* a cached list answers at once; discovery can take over a minute */ return json(res, 200, { ...mcp.summary(), tools: backend === 'claude-cli' }); }
    if (url.pathname === '/api/brain') return json(res, 200, graph);
    if (url.pathname === '/api/usage') return json(res, 200, await getUsage(url.searchParams.get('refresh') === '1')); // V3.6: the plan's gauge (never a 500: unavailable is an answer)
    if (url.pathname === '/api/tasks' && req.method === 'GET') return json(res, 200, load());
    if (url.pathname === '/api/routines' && req.method === 'GET') return json(res, 200, routinesOut());
    if (url.pathname === '/api/routines' && req.method === 'POST') {
      const b = await body(req);
      if (!DEPTS[b.dept] || b.dept === 'brain') return json(res, 400, { error: 'unknown department' });
      if (!routines.ALLOWED.includes(b.dept)) return json(res, 400, { error: routines.refusal(b.dept), refused: true });
      const r = await makeRoutine({ dept: b.dept, text: b.text, when: b.when, agent: b.agent, needsOk: b.needsOk, model: b.model, effort: b.effort });
      return json(res, r.error ? 400 : 200, r);
    }
    const rm = url.pathname.match(/^\/api\/routines\/([^/]+)(?:\/(run|pause|resume))?$/);
    if (rm) {
      const r = loadRoutines().find(x => x.id === rm[1]);
      if (!r) return json(res, 404, { error: 'no such routine' });
      if (req.method === 'DELETE') { removeRoutine(r.id); return json(res, 200, { ok: true, routines: loadRoutines() }); }
      if (req.method !== 'POST') return json(res, 405, { error: 'POST or DELETE' });
      if (rm[2] === 'run') return json(res, 200, { ok: true, task: fire(r, { by: 'you' }), routines: loadRoutines() });
      if (rm[2] === 'pause' || rm[2] === 'resume') { editRoutine(r.id, { paused: rm[2] === 'pause' }); return json(res, 200, { ok: true, routines: loadRoutines() }); }
      const b = await body(req); const patch = {};
      if (typeof b.needsOk === 'boolean') patch.needsOk = b.needsOk; if (typeof b.paused === 'boolean') patch.paused = b.paused;
      if (typeof b.text === 'string' && b.text.trim()) patch.text = b.text.trim(); if (typeof b.title === 'string' && b.title.trim()) patch.title = b.title.trim().slice(0, 90);
      if (b.when && validWhen(b.when)) patch.when = b.when;
      if (b.model !== undefined) patch.model = normModel(b.model) || '';
      if (b.effort !== undefined) patch.effort = normEffort(b.effort) || '';
      editRoutine(r.id, patch); return json(res, 200, { ok: true, routines: loadRoutines() });
    }
    if (url.pathname === '/api/tasks' && req.method === 'POST') {
      const { dept, text, model, effort, after, goal, agent: named, needsOk: saysOk, deadline, budget } = await body(req);
      if (!DEPTS[dept] || dept === 'brain') return json(res, 400, { error: 'unknown department' });
      const plan = planFields({ deadline, budget }); if (plan.problems.length) return json(res, 400, { error: plan.problems.join('; ') });
      if (!text || !String(text).trim()) return json(res, 400, { error: 'empty task' });
      const direct = named && AGENTS.find(a => a.id === named && a.department === dept); // given to a named agent: no routing call
      if (named && !direct) return json(res, 400, { error: `${named} is not an agent in ${dept}` });
      const r = direct ? { agent: direct.id, title: String(text).trim().split(/(?<=[.!?])\s|\n/)[0].slice(0, 90), plan: [], eta: 15, why: 'assigned by name', needsOk: typeof saysOk === 'boolean' ? saysOk : routines.guessNeedsOk(text) } : await route(dept, String(text).trim());
      // needsOk is the router's judgement and it is kept: a task typed into the bar that sends, posts or
      // pays now drafts first and waits for the OK, exactly like a routine does
      const task = newTask({ dept, agent: r.agent, title: r.title, text: String(text).trim(), plan: r.plan, why: r.why, needsOk: r.needsOk, after: Array.isArray(after) ? after.map(String) : [], goal: goal ? String(goal).slice(0, 80) : undefined, model: normModel(model) || undefined, effort: normEffort(effort) || undefined, extra: plan.fields }); // model/effort: set on this task (beats routine, agent, office)
      task.eta = r.eta;
      console.log(`+ ${task.id} → ${task.agent}: ${task.title}${task.needsOk ? ' (drafts first, waits for your OK)' : ''}${task.state === 'blocked' ? ' (' + task.blockedReason + ')' : ''}`);
      return json(res, 200, task);
    }
    if (url.pathname === '/api/pending' && req.method === 'GET') { const p = coord.pending(load(), { paused: pausedNow(), agentName }); p.items.push(...pipelineDecisions(), ...researchDecisions(), ...lessonDecisions());
      for (const i of p.items) if (i.kind === 'approval' && seatLimited(i.agent)) { i.limited = { level: seatLevel(i.agent), required: REQUIRED_FOR_OUTBOUND }; i.decision += ` ${agentName(i.agent)} is "${i.limited.level}", below the "${REQUIRED_FOR_OUTBOUND}" needed for outbound work: approving needs your override and a reason.`; }
      p.count = p.items.length; return json(res, 200, p); }
    if (url.pathname === '/api/research' && req.method === 'GET') { const st = research.loadState(DATA); return json(res, 200, { ...research.stats(st, research.loadConfig(BRAIN)), findings: st.findings.slice(-50), published: st.published, effects: research.ruleEffect(st, { brainPath: BRAIN, rolesOf: skillRoles }), watch: st.watch }); }
    if (url.pathname === '/api/research/watch' && req.method === 'POST') return json(res, 200, await researchWatch({ manual: true })); // check the watched pages now
    if (url.pathname === '/api/research/run' && req.method === 'POST') { const r = researchRun(); return json(res, r.error ? r.status : 200, r.error ? { error: r.error } : r); }
    if (url.pathname === '/api/research/rollback' && req.method === 'POST') { const b = await body(req); const st = research.loadState(DATA); const r = research.rollback(st, { brainPath: BRAIN, skill: b.skill, why: String(b.why || '') }); if (r.error) return json(res, r.status, { error: r.error }); research.saveState(DATA, st); refreshSkills(); brainGit.snapshot('research: rolled back ' + b.skill); console.log('  ↺ research rule rolled back from ' + b.skill); return json(res, 200, r); }
    const rp = url.pathname.match(/^\/api\/research\/findings\/([a-f0-9]{16})\/publish$/);
    if (rp && req.method === 'POST') { const b = await body(req); const st = research.loadState(DATA); const r = research.publish(st, { brainPath: BRAIN, shippedDir: path.join(ROOT, 'skills'), key: rp[1], skill: b.skill, rule: b.rule, approvedBy: b.approvedBy, tested: b.tested }); if (r.error) return json(res, r.status, { error: r.error }); research.saveState(DATA, st); refreshSkills(); brainGit.snapshot('research: published a rule to ' + r.published.skill); console.log('  ★ research rule published to ' + r.published.skill + ' v' + r.published.version); return json(res, 200, r); }
    if (url.pathname === '/api/coverage' && req.method === 'GET') { refreshSkills(); let tl = []; try { tl = load(); } catch {} return json(res, 200, coverageMod.coverage({ agents: AGENTS, skills, brainPath: BRAIN, tasks: tl, lessons: id => learn.count(BRAIN, id) })); }
    const cr = url.pathname.match(/^\/api\/coverage\/([a-z0-9_-]+)\/review$/);
    if (cr && req.method === 'POST') { // the owner's review of a seat's fixture answers: the only thing that makes a seat "tested"
      const b = await body(req);
      if (b.approvedBy !== 'owner') return json(res, 403, { error: 'only the owner reviews a seat: send "approvedBy": "owner"' });
      if (typeof b.passed !== 'boolean') return json(res, 400, { error: 'say whether the answers passed: {"passed": true|false, "notes": "…"}' });
      const id = cr[1], fx = path.join(BRAIN, 'Agents Office', 'fixtures', id), cf = path.join(BRAIN, 'Agents Office', 'contracts', id + '.md');
      let contract; try { contract = fs.readFileSync(cf, 'utf8'); } catch { return json(res, 409, { error: 'this seat has no capability contract to review against' }); }
      if (!coverageMod.checkContract(contract).complete) return json(res, 409, { error: 'the contract is incomplete — finish it before reviewing' });
      const runs = fs.existsSync(fx) ? fs.readdirSync(fx).filter(n => /^results-.*\.json$/.test(n)).sort() : [];
      if (!runs.length) return json(res, 409, { error: 'run the fixtures first (node fixtures.mjs ' + id + ') — a review needs answers to read' });
      const review = { contractHash: hash(contract), resultsFile: runs.at(-1), passed: b.passed, notes: String(b.notes || '').slice(0, 1000), reviewedBy: 'owner', reviewedAt: new Date().toISOString() };
      fs.writeFileSync(path.join(fx, 'review.json'), JSON.stringify(review, null, 2)); brainGit.snapshot('review: ' + id + (b.passed ? ' passed' : ' failed'));
      return json(res, 200, { ok: true, review });
    }
    if (url.pathname === '/api/pipeline' && req.method === 'GET') return json(res, 200, acq.summary(acq.loadPipeline(DATA), acq.loadConstraints(BRAIN)));
    if (url.pathname === '/api/pipeline/advance' && req.method === 'POST') return json(res, 200, pipelineAdvance());
    const pm = url.pathname.match(/^\/api\/pipeline\/([^/]+)\/mark$/);
    if (pm && req.method === 'POST') { const b = await body(req); const r = pipelineMark(decodeURIComponent(pm[1]), String(b.event || ''), String(b.note || '').trim().slice(0, 300)); return json(res, r.error ? 400 : 200, r); } // everything waiting on the owner, as decisions
    if (url.pathname === '/api/office/pause' && req.method === 'POST') { const b = await body(req); return json(res, 200, { ok: true, paused: setPaused(true, b.why) }); }
    if (url.pathname === '/api/office/stop' && req.method === 'POST') { json(res, 200, { ok: true, stopping: true }); setTimeout(() => shutdown('stop requested', STOPPED_ON_PURPOSE), 50); return; }
    if (url.pathname === '/api/office/resume' && req.method === 'POST') { return json(res, 200, { ok: true, paused: setPaused(false) }); }
    const own = url.pathname.match(/^\/api\/tasks\/([^/]+)\/(cancel|reassign|checked|answer|handoff|plan)$/);
    if (own && req.method === 'POST') {
      const b = await body(req);
      if (own[2] === 'handoff') { // the owner (or Claude Code) hands a finished piece of work on to another agent
        const up = load().find(t => t.id === own[1]); if (!up) return json(res, 404, { error: 'no such task' });
        const a = AGENTS.find(x => x.id === b.agent); if (!a) return json(res, 400, { error: 'no such agent' });
        const text = String(b.text || '').trim(); if (!text) return json(res, 400, { error: 'say what the next agent must do' });
        const t = newTask({ dept: a.department, agent: a.id, title: text.split(/(?<=[.!?])\s/)[0].slice(0, 90), text, needsOk: typeof b.needsOk === 'boolean' ? b.needsOk : routines.guessNeedsOk(text), after: [up.id], goal: up.goal || up.id, by: 'handoff', why: `handed on from "${up.title}"` });
        return json(res, 200, t);
      }
      const r = ownerAction(own[1], own[2], b);
      return json(res, r.error ? r.status : 200, r.error ? { error: r.error } : { ok: true, ...r });
    }
    const m = url.pathname.match(/^\/api\/tasks\/([^/]+)(?:\/(run|revise|approve|reject))?$/);
    const learnFrom = (t, note) => { // a correction becomes a lesson only when the rework it asked for actually happened
      const a = AGENTS.find(x => x.id === t.agent);
      learn.classify(ask, a, t, note).then(v => { const r = learn.record(BRAIN, a, t, note, v); console.log(`  ↳ ${a.name} ${r.promoted ? 'made it a standing rule (the owner said it twice)' : r.proposed ? 'proposed a rule for the owner to confirm' + (r.conflict ? ' — it conflicts with another rule' : '') : r.duplicate ? 'already had that rule' : 'noted a one-off'}: ${r.line.slice(0, 100)}`); })
        .catch(e => console.warn('learn:', e.message));
    };
    if (m && req.method === 'POST' && (m[2] === 'approve' || m[2] === 'reject')) { // D1: the owner's tick (or note) on a draft
      const b = await body(req);
      const note = String(b.feedback || '').trim();
      const c = claim(m[1], m[2], { waitingAt: b.waitingAt, override: b.override }); // after the body is read: nothing may await between the check and the claim
      if (c.error) return json(res, c.status, { error: c.error, state: c.task?.state });
      console.log(`${m[2] === 'approve' ? '✅' : '↩'} ${c.task.id} ${m[2] === 'approve' ? 'approved — ' + agentName(c.task.agent) + ' is sending' : 'sent back: ' + note.slice(0, 80)}`);
      enqueue(() => execute(c.task.id, c.attempt.id, m[2] === 'reject' ? { feedback: note || 'Not this. Rework it.' } : {}))
        .then(t => { if (m[2] === 'reject' && note && t && t.state === 'waiting' && !t.lastError) learnFrom(t, note); })
        .catch(e => console.warn('approval:', e.message));
      return json(res, 200, { ok: true, id: c.task.id, state: 'doing', attempt: c.attempt.id });
    }
    if (m && req.method === 'POST' && (m[2] === 'run' || m[2] === 'revise')) {
      const { feedback } = m[2] === 'revise' ? await body(req) : {};
      const c = claim(m[1], m[2]);
      if (c.error) return json(res, c.status, { error: c.error, state: c.task?.state });
      const t = await execute(c.task.id, c.attempt.id, { feedback }); // keeps going if the page goes away; the page's poll picks the result up
      if (!t) return json(res, 404, { error: 'the task was deleted while it ran' });
      json(res, 200, t);
      if (feedback && !t.error && !t.lastError) learnFrom(t, feedback); // after the reply is out the door
      return;
    }
    if (m && req.method === 'DELETE') { save(load().filter(t => t.id !== m[1])); return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const { agent, text, history, images } = await body(req);
      const pics = validateImages(images);
      if ((!text || !String(text).trim()) && !pics.length) return json(res, 400, { error: 'empty message' });
      const a = AGENTS.find(x => x.id === agent); if (!a) return json(res, 400, { error: 'unknown agent' });
      if (!onboard.active(DATA, a.department)) { // V3.5: "every weekday at 8am, …" · "routines" · "pause …" · "run … now" — unless the lead is mid-interview
        const rc = await routinesChat(a, String(text).trim());
        if (rc) return json(res, 200, { reply: rc.reply, read: [], tools: [], interview: false, routine: rc.routine || null, routines: true });
      }
      if (leadOf(a.department).id === a.id) { // the department lead can run the set-up interview
        refreshSkills();
        const o = await onboard.handle(String(text).trim(), { dept: a.department, deptName: DEPTS[a.department].name, lead: a, agents: AGENTS.filter(x => x.department === a.department),
          connected: mcp.summary().servers?.filter(x => x.status === 'connected').map(x => x.name || x.key) || [], brainPath: BRAIN, dataDir: DATA, ask, business: cfg.name, afterWrite: refreshSkills });
        if (o) { if (o.wrote) console.log(`★ ${a.name} set up ${DEPTS[a.department].name}: ${o.wrote.briefs.length} briefs${o.wrote.skill ? ', skill ' + o.wrote.skill.name : ''}`); return json(res, 200, { reply: o.reply, read: [], tools: [], interview: !o.wrote, setup: setupMap() }); }
      }
      const r = await chat(agent, String(text || '').trim() || '(see the attached image)', history, pics);
      return json(res, 200, { ...r, interview: false, images: pics.length });
    }
    json(res, 404, { error: 'not found' });
  } catch (e) { console.error(e); json(res, 500, { error: e.message }); }
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`✗ port ${cfg.port} on ${HOST} is already in use — another office (or another program) has it. Stop that one, or start this one with PORT=<another port>.`);
  else console.error('✗ server:', e.message);
  ops.releaseLock(DATA);
  process.exit(1);
});

/* ---------- running continuously (Phase 8, ops.mjs) ---------- */
// The heartbeat. Timers do not fire while the machine sleeps, so a long gap between beats is a sleep
// (or the office being off), and it is surfaced rather than silently leaving routines late.
const heartbeat = { last: null, sleeps: [] };
{ const prev = office.lastHeartbeat; if (prev && STARTED - prev > 7 * 60 * 1000) heartbeat.sleeps.push({ from: prev, to: STARTED, kind: 'off' }); }
let lastBeatSaved = 0;
function beat(now = Date.now()) {
  if (heartbeat.last && now - heartbeat.last > 90 * 1000) { heartbeat.sleeps.push({ from: heartbeat.last, to: now, kind: 'asleep' }); console.log(`  ☾ the machine was asleep for ${Math.round((now - heartbeat.last) / 60000)} min`); }
  heartbeat.sleeps = heartbeat.sleeps.slice(-20);
  heartbeat.last = now;
  if (now - lastBeatSaved > 5 * 60 * 1000) { lastBeatSaved = now; try { office.lastHeartbeat = now; writeJSON(OFFICE_FILE, office); } catch {} }
}
function readiness() {
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });
  add('brain folder', fs.existsSync(BRAIN), BRAIN);
  try { load(); add('task store readable', true); } catch (e) { add('task store readable', false, e.message); }
  add('Claude available', backend !== 'claude-cli' || !!claudeBin(cfg), backend === 'claude-cli' ? claudeSource(cfg) : 'API');
  add('routines valid', !rlist.problems.length, rlist.problems.slice(0, 3).join('; '));
  add('roster valid', !roster.problems.length, roster.problems.slice(0, 3).join('; '));
  add('clock', CLOCK_ON, CLOCK_ON ? 'on' : 'off (AO_CLOCK=off)');
  add('this machine only', LOOPBACK, HOST);
  return { ok: checks.filter(c => !['clock'].includes(c.name)).every(c => c.ok), checks };
}
function opsSummary() {
  const now = Date.now(); let tasks = []; try { tasks = load(); } catch {}
  const since = now - 864e5, count = f => tasks.filter(f).length;
  const rl = loadRoutines();
  let index = null; try { index = vaultIndex(); } catch {}
  return {
    at: now, instance: { pid: process.pid, startedAt: STARTED, version, port: cfg.port, data: DATA }, paused: pausedNow(), heartbeat, ready: readiness(),
    problems: [...(index ? ops.priceConflicts(index) : []), ...ops.problems({ tasks, sleeps: heartbeat.sleeps, usage: usageCache.value, ceiling: USAGE_CEILING, claudeFound: backend !== 'claude-cli' || !!claudeBin(cfg) })],
    tasks: { next: count(t => t.state === 'next'), doing: count(t => t.state === 'doing'), review: count(t => t.state === 'review'), waiting: count(t => t.state === 'waiting'), blocked: count(t => t.state === 'blocked'),
      unknown: count(t => t.needsCheck), failed24h: count(t => t.state === 'done' && t.error && !t.needsCheck && (t.doneAt || 0) > since), done24h: count(t => t.state === 'done' && !t.error && !t.noop && (t.doneAt || 0) > since), noop24h: count(t => t.noop && (t.doneAt || 0) > since) },
    routines: rl.map(r => { const lt = tasks.filter(t => t.routine === r.id).at(-1); return { id: r.id, title: r.title, agent: agentName(r.agent), desc: r.desc, paused: r.paused, needsOk: r.needsOk, nextAt: r.nextAt, lastAt: r.lastAt,
      last: lt ? { id: lt.id, state: lt.state, error: !!lt.error, noop: !!lt.noop, review: lt.review?.verdict || null } : null }; }),
    usage: usageCache.value, pipeline: (({ active, missing, counts, file }) => ({ active, missing, counts, file }))(acq.summary(acq.loadPipeline(DATA), acq.loadConstraints(BRAIN))),
    research: research.stats(research.loadState(DATA), research.loadConfig(BRAIN)),
    freshness: index ? ops.freshness(index, CORE_NOTES) : [],
    seats: (() => { try { const c = coverageMod.coverage({ agents: AGENTS, skills, brainPath: BRAIN }); return { levels: c.levels, firstClient: c.list.filter(r => r.firstClient || r.level !== 'generic' && r.level !== 'briefed').map(r => ({ id: r.id, name: r.name, level: r.level, gaps: r.gaps })) }; } catch { return null; } })(), // readiness: a seat is only "tested" after the owner's review
  };
}
// A clean stop (Ctrl+C in the launcher window, or a service stop): no new work, running Claude
// processes ended, the reason recorded. What was mid-flight is recovered on the next start exactly
// as after a crash — nothing that may have sent is sent again.
let stopping = false;
const STOPPED_ON_PURPOSE = 3; // start-office.cmd does not restart an office that was stopped on purpose
function shutdown(signal, code = 0) {
  if (stopping) return; stopping = true;
  console.log(`■ stopping (${signal}) — ${CHILDREN.size} Claude run${CHILDREN.size === 1 ? '' : 's'} in progress will be picked up on the next start`);
  try { const running = load().filter(t => RUNNING.includes(t.state)).map(t => t.id); office.lastShutdown = { at: Date.now(), signal, running }; office.lastHeartbeat = Date.now(); writeJSON(OFFICE_FILE, office); } catch {}
  for (const c of CHILDREN) { try { c.kill(); } catch {} }
  server.close(); ops.releaseLock(DATA);
  setTimeout(() => process.exit(code), 300);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) { try { process.on(sig, () => shutdown(sig)); } catch {} }

server.listen(cfg.port, HOST, () => {
  console.log(`Agents Office ${version} → http://localhost:${cfg.port}${LOOPBACK ? '   (this machine only)' : '   ⚠ listening on ' + HOST + ' — anyone who can reach it can run and approve tasks'}`);
  console.log(`  business: ${cfg.name}   brain: ${BRAIN} (${graph.notes} notes, ${graph.links.length} links)   claude: ${backend}${backend === 'claude-cli' ? ' (' + claudeSource(cfg) + ')' : ''} · ${modelName(cfg.model)}${cfg.effort ? ' · effort ' + cfg.effort : ''} by default (routing on Sonnet)`);
  if (backend === 'claude-cli' && !claudeBin(cfg)) console.warn('  ⚠ no Claude Code binary found — tasks and chat will fail. Install the CLI (npm i -g @anthropic-ai/claude-code) or set "claudePath" in office.config.json.');
  if (USAGE_ON) getUsage(true).then(u => console.log(u.source === 'claude' ? `  usage: session ${u.session?.percent ?? '—'}% · week ${u.week?.percent ?? '—'}% (your Claude plan, as Claude Code shows it)` : `  usage: Claude's gauge unavailable (${u.reason}) — showing the office's own count`)).catch(() => {});
  brainGit.ensureRepo(BRAIN);
  console.log(`  tasks: ${FILE}   notes the agents write: ${NOTES_DIR}`);
  console.log(`  operations: http://localhost:${cfg.port}/ops   (problems, decisions waiting on you, routines, pause, stop)`);
  console.log(`  usage guard: routines hold above ${USAGE_CEILING}% of the session window (usageCeiling in office.config.json)`);
  console.log(`  brain history: ${brainGit.enabled() ? 'on — every agent write is committed to ' + BRAIN + ' (git log to review, git revert to undo)' : 'OFF'}`);
  const rl = loadRoutines(); const nx = rl.filter(r => !r.paused && r.nextAt).sort((a, b) => a.nextAt - b.nextAt)[0];
  console.log(`  routines: ${rl.length} loaded${rl.some(r => r.paused) ? ' (' + rl.filter(r => r.paused).length + ' paused)' : ''}${nx ? ' · next ' + untilText(nx.nextAt) + ' ' + nx.title.toUpperCase() + ' (' + nx.agent + ')' : ''} · ${rlist.path}`);
  if (!fs.existsSync(acq.constraintsFile(BRAIN))) { try { fs.mkdirSync(path.dirname(acq.constraintsFile(BRAIN)), { recursive: true }); fs.writeFileSync(acq.constraintsFile(BRAIN), JSON.stringify(acq.template(), null, 2) + '\n'); console.log(`  acquisition: wrote ${acq.constraintsFile(BRAIN)} with every limit unset — the owner fills it in`); } catch {} }
  else { try { const cur = JSON.parse(fs.readFileSync(acq.constraintsFile(BRAIN), 'utf8')); const added = Object.keys(acq.CONSTRAINTS).filter(k => !(k in cur)); if (added.length) { for (const k of added) cur[k] = null; cur._meaning = { ...(cur._meaning || {}), ...acq.CONSTRAINTS }; fs.writeFileSync(acq.constraintsFile(BRAIN), JSON.stringify(cur, null, 2) + '\n'); console.log(`  acquisition: added unset slots for ${added.join(', ')} — nothing the owner set was changed`); } } catch {} } // new slots appear unset; set values are never touched
  recoverTasks(); // before the clock: pick up what a crash or restart left mid-flight
  pipelineSync();
  researchSync();
  if (!fs.existsSync(research.configFile(BRAIN))) { try { fs.writeFileSync(research.configFile(BRAIN), JSON.stringify(research.template(), null, 2) + String.fromCharCode(10)); console.log('  research: wrote ' + research.configFile(BRAIN) + ' with the budget unset'); } catch {} }
  { const c = research.loadConfig(BRAIN); console.log('  research: ' + (c.active ? 'ACTIVE, ' + c.config.runsPerWeek + ' run(s) a week' : 'off — ' + (c.missing.length ? 'not set: ' + c.missing.join(', ') : '"active" is not true'))); }
  { const c = acq.loadConstraints(BRAIN); console.log(`  acquisition workflow: ${c.active ? 'ACTIVE' : 'off — ' + (c.missing.length ? 'not set: ' + c.missing.join(', ') : '"active" is not true')}`); }
  beat(); setInterval(beat, 20000); // liveness: the heartbeat runs with or without the clock
  if (CLOCK_ON) { setInterval(tickRoutines, 20000); tickRoutines(); } // the clock: every 20 s; the first tick catches up anything missed while the office was off (once, marked LATE)
  else console.log('  clock: OFF (AO_CLOCK=off) — no routine will fire');
  console.log(`  agents: ${AGENTS.length} (${roster.customised} customised${roster.briefed ? ', ' + roster.briefed + ' briefed' : ''}${roster.files.length ? ' via ' + roster.files.join(' + ') : ''})   tools: ${backend === 'claude-cli' ? 'connected MCP servers' + (cfg.tools?.web === false ? '' : ' + web') : 'none on the API backend'}`);
  const sk = skills.summary(); const setup = setupMap(); const notYet = DEPT_KEYS.filter(k => !setup[k]);
  console.log(`  skills: ${sk.count} (${sk.shipped} shipped in skills/, ${sk.brain} in ${path.join(NOTES_DIR, 'skills')})${sk.problems.length ? '   ⚠ ' + sk.problems.length + ' problem' + (sk.problems.length > 1 ? 's' : '') + ' — see npm run check' : ''}`);
  console.log(`  set up: ${notYet.length === DEPT_KEYS.length ? 'no department yet — open a lead\'s chat and say "set up"' : notYet.length ? DEPT_KEYS.length - notYet.length + ' of ' + DEPT_KEYS.length + ' departments (not yet: ' + notYet.map(k => DEPTS[k].name).join(', ') + ')' : 'all ' + DEPT_KEYS.length + ' departments'}   lessons: ${learn.dir(BRAIN)}`);
});
