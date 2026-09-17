// Agents Office — the first-client acquisition workflow (Phase 6 of the reliability handoff).
//
// One closed loop, proved end to end before anything else is switched on:
//
//   1 target     the icp and offer-ladder notes, and the owner's constraints (acquisition.json)
//   2 research   PROSPECTOR returns prospect records, every claim with the URL it came from
//   3 qualify    SALES LEAD says yes / no / unclear from that evidence — unclear goes to the owner, never a score
//   4 draft      PROSPECTOR drafts one first touch, opening with a cited reason
//   5 review     QA reads it, then the owner approves that exact draft (serve.mjs)
//   6 send+log   the approved send records its remote reference; an uncertain send is reconciled, never resent
//   7 follow up  only on the owner's cadence, only up to the owner's limit, never after a reply or an opt-out
//   8 propose    PROPOSALS drafts from the approved price list; "signed" is the owner's word, separate from "sent";
//                won hands the client to DELIVERY LEAD for a plan
//
// State: data/pipeline.json (operational, like tasks.json). Constraints: <brain>/Agents Office/acquisition.json,
// which the owner sets. Nothing here invents a limit: until the required ones are set the workflow
// answers with what is missing and creates no work.
import fs from 'node:fs';
import path from 'node:path';
import { readJSON, writeJSON } from './store.mjs';

const DAY = 864e5;
export const CONSTRAINTS = {
  outreachPerDayMax: 'how many first touches may be drafted in a day (the effort ceiling)',
  followUpDays: 'how many days after a first touch a follow-up is drafted',
  maxFollowUps: 'how many follow-ups before a prospect is left alone',
  spendCeiling: 'what may be spent to win the first client (0 means nothing: no paid tools, no ads)',
  deadline: 'by when the first client is wanted (YYYY-MM-DD)',
  // commercial terms — optional to start the workflow, but a proposal cannot state them until they are set
  partnerRates: 'what partners charge for partner-delivered work (website, brand, video…), e.g. {"website": "USD 4000 per build"}',
  partnerMargin: 'the margin added on top of a partner\'s quote (e.g. "25%")',
  paymentTerms: 'contractual payment terms stated in proposals (e.g. "monthly in advance, net 7")',
};
export const REQUIRED = ['outreachPerDayMax', 'followUpDays', 'maxFollowUps', 'spendCeiling'];
export const ROLES = { research: 'pros', qualify: 'lexi', draft: 'pros', followup: 'folo', proposal: 'piper', delivery: 'dlead' };

export const constraintsFile = brainPath => path.join(brainPath, 'Agents Office', 'acquisition.json');
export const pipelineFile = dataDir => path.join(dataDir, 'pipeline.json');

export function template() {
  return { _about: 'The owner sets these. Until every required one is set and "active" is true, the acquisition workflow creates no work. null = not established.',
    active: false, ...Object.fromEntries(Object.keys(CONSTRAINTS).map(k => [k, null])), _meaning: CONSTRAINTS };
}
export function loadConstraints(brainPath) {
  const file = constraintsFile(brainPath);
  let c = null; try { c = readJSON(file, null); } catch (e) { return { file, config: {}, missing: REQUIRED, active: false, problem: e.message }; }
  const config = c || {};
  const missing = REQUIRED.filter(k => config[k] === null || config[k] === undefined || config[k] === '' || !(Number(config[k]) >= 0));
  return { file, exists: !!c, config, missing, active: config.active === true && !missing.length };
}

// `seen` (task id → the task state already applied) must survive a load: without it every sync
// re-applies finished tasks — a follow-up counted 170 times in the first test run
export const loadPipeline = dataDir => { const p = readJSON(pipelineFile(dataDir), null) || {}; return { prospects: Array.isArray(p.prospects) ? p.prospects : [], runs: Array.isArray(p.runs) ? p.runs : [], seen: p.seen && typeof p.seen === 'object' ? p.seen : {} }; };
export const savePipeline = (dataDir, p) => writeJSON(pipelineFile(dataDir), p);

export const keyOf = r => {
  const d = String(r.domain || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').trim();
  return d || String(r.company || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
};
const isUrl = u => /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(String(u || ''));

/** The JSON inside a ```<tag> fenced block. */
export function parseBlock(text, tag) {
  const m = String(text || '').match(new RegExp('```' + tag + '\\s*\\n([\\s\\S]*?)```', 'i'));
  if (!m) return { error: `no \`\`\`${tag} block in the result` };
  try { return { value: JSON.parse(m[1]) }; } catch (e) { return { error: `the ${tag} block is not valid JSON: ${e.message}` }; }
}

/** Research records → accepted into the pipeline, or rejected with the reason. No source, no record. */
export function acceptResearch(pipeline, items, { taskId, now = Date.now() } = {}) {
  const accepted = [], rejected = [];
  const known = new Map(pipeline.prospects.map(p => [p.key, p]));
  for (const it of Array.isArray(items) ? items : []) {
    const company = String(it?.company || '').trim();
    const key = keyOf(it || {});
    const evidence = (Array.isArray(it?.fitEvidence) ? it.fitEvidence : []).filter(e => e && String(e.claim || '').trim() && isUrl(e.url)).map(e => ({ claim: String(e.claim).trim().slice(0, 300), url: e.url }));
    const why = !company ? 'no company name'
      : !key ? 'no domain or name to identify it'
      : !isUrl(it.source?.url) ? 'no source URL — a prospect nobody can check is not a prospect'
      : !evidence.length ? 'no fit evidence with a URL'
      : known.get(key)?.stage === 'opted-out' ? 'asked not to be contacted'
      : known.has(key) || accepted.some(a => a.key === key) ? 'already in the pipeline'
      : null;
    if (why) { rejected.push({ company: company || '(unnamed)', key, why }); continue; }
    const email = it.contact?.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(it.contact.email) ? it.contact.email : null;
    accepted.push({ key, company, domain: it.domain || null, country: it.country || null,
      contact: { name: it.contact?.name || null, role: it.contact?.role || null, email },
      source: { url: it.source.url, retrievedAt: it.source.retrievedAt || new Date(now).toISOString().slice(0, 10), publishedAt: it.source.publishedAt || null },
      fitEvidence: evidence, trigger: it.trigger || null, stage: 'researched', outreach: [], followUps: 0,
      history: [{ at: now, stage: 'researched', why: `found by research task ${taskId || '?'}` }] });
  }
  pipeline.prospects.push(...accepted);
  return { accepted, rejected };
}

const move = (p, stage, why, now = Date.now()) => { if (p.stage !== stage) { p.stage = stage; p.history = [...(p.history || []), { at: now, stage, why }].slice(-50); } };

/** Qualification answers → qualified / disqualified / needs-review. "yes" without reasons, or with anything missing, is not a yes. */
export function applyQualification(pipeline, items, { taskId, now = Date.now() } = {}) {
  const out = { qualified: [], disqualified: [], review: [], ignored: [] };
  for (const it of Array.isArray(items) ? items : []) {
    const p = pipeline.prospects.find(x => x.key === it?.key);
    if (!p || p.stage !== 'researched') { out.ignored.push(it?.key); continue; }
    const reasons = (it.reasons || []).map(String).filter(Boolean), missing = (it.missing || []).map(String).filter(Boolean), dis = (it.disqualifiers || []).map(String).filter(Boolean);
    p.qualification = { fit: it.fit, reasons, missing, disqualifiers: dis, taskId, at: now };
    if (it.fit === 'yes' && reasons.length && !missing.length && !dis.length) { move(p, 'qualified', 'fits the ICP: ' + reasons[0], now); out.qualified.push(p.key); }
    else if (it.fit === 'no' && dis.length) { move(p, 'disqualified', 'does not fit: ' + dis[0], now); out.disqualified.push(p.key); }
    else { move(p, 'needs-review', missing.length ? 'evidence missing: ' + missing.join('; ') : 'fit unclear — the owner decides', now); out.review.push(p.key); }
  }
  for (const p of pipeline.prospects) if (p.stage === 'researched' && p.qualifyTask === taskId && !items?.some?.(i => i?.key === p.key)) { move(p, 'needs-review', 'the qualification did not cover it', now); out.review.push(p.key); }
  return out;
}

const liveOutreach = p => (p.outreach || []).filter(o => !['not-sent', 'cancelled', 'nothing-to-send'].includes(o.status));

/** What the workflow should do next. Pure: serve.mjs turns actions into tasks. */
export function plan(pipeline, constraints, openTasks, { now = Date.now() } = {}) {
  if (!constraints.active) return { actions: [], noop: constraints.missing.length
    ? `The acquisition workflow is off: ${constraints.missing.map(k => `${k} (${CONSTRAINTS[k]})`).join('; ')} ${constraints.missing.length > 1 ? 'are' : 'is'} not set in ${path.basename(constraints.file || 'acquisition.json')}. These are the owner's decisions; nothing was started.`
    : `The acquisition workflow is off: "active" is not true in ${path.basename(constraints.file || 'acquisition.json')}.` };
  const c = constraints.config, actions = [];
  const open = step => openTasks.filter(t => t.pipeline?.step === step);
  const openFor = key => openTasks.some(t => t.pipeline?.key === key || (t.pipeline?.keys || []).includes(key));
  const P = pipeline.prospects;
  const researched = P.filter(p => p.stage === 'researched' && !openFor(p.key));
  const qualified = P.filter(p => p.stage === 'qualified' && !liveOutreach(p).length && !openFor(p.key));
  if (researched.length && !open('qualify').length) actions.push({ step: 'qualify', keys: researched.map(p => p.key) });
  const today = new Date(now).toISOString().slice(0, 10);
  const draftedToday = P.flatMap(p => p.outreach || []).filter(o => o.kind === 'first' && String(o.createdAt ? new Date(o.createdAt).toISOString() : '').startsWith(today)).length + open('draft').length;
  const room = Math.max(0, Number(c.outreachPerDayMax) - draftedToday);
  for (const p of qualified.slice(0, room)) actions.push({ step: 'draft', key: p.key });
  for (const p of P.filter(p => p.stage === 'contacted' && !openFor(p.key))) {
    const last = Math.max(...(p.outreach || []).filter(o => o.status === 'sent').map(o => o.sentAt || 0), 0);
    if (!last || (p.followUps || 0) >= Number(c.maxFollowUps)) continue;
    if (now - last >= Number(c.followUpDays) * DAY) actions.push({ step: 'followup', key: p.key });
  }
  if (!researched.length && !qualified.length && !open('research').length && !open('qualify').length && !open('draft').length && room > 0)
    actions.push({ step: 'research', count: Math.min(room, 5) });
  return { actions, noop: actions.length ? null : room <= 0 && qualified.length ? `Today's ceiling of ${c.outreachPerDayMax} first touches is reached; ${qualified.length} qualified prospect${qualified.length > 1 ? 's wait' : ' waits'} for tomorrow.` : 'Nothing to do right now: work is already open for every prospect, or nothing is due.' };
}

/** Prompts for each step. Every one ends in structured output the server checks. */
// The owner's commercial terms as a proposal must state them: set values verbatim, unset ones named as
// not established, so a proposal never invents a payment term, a partner price or a markup.
export function termsText(config = {}) {
  const v = x => x === null || x === undefined || x === '' ? null : typeof x === 'object' ? JSON.stringify(x) : String(x);
  return [`Payment terms: ${v(config.paymentTerms) ?? 'not established — write "(payment terms to confirm)", never invent them'}.`,
    `Partner-delivered work: rates ${v(config.partnerRates) ?? 'not established'}; margin ${v(config.partnerMargin) ?? 'not established'}. Without both, partner work is "(price to confirm)" and needs the partner's own quote.`].join('\n');
}
export function taskFor(action, pipeline, { exclude = [], config = {} } = {}) {
  const P = key => pipeline.prospects.find(p => p.key === key);
  const card = p => [`KEY: ${p.key}`, `Company: ${p.company}${p.domain ? ' (' + p.domain + ')' : ''}${p.country ? ', ' + p.country : ''}`, `Contact: ${p.contact?.name || 'not found'}${p.contact?.role ? ', ' + p.contact.role : ''}${p.contact?.email ? ' <' + p.contact.email + '>' : ' (no email found)'}`,
    `Source: ${p.source.url} (retrieved ${p.source.retrievedAt})`, 'Evidence:', ...p.fitEvidence.map(e => `- ${e.claim} — ${e.url}`), p.trigger ? `Trigger: ${p.trigger}` : null].filter(Boolean).join('\n');
  switch (action.step) {
    case 'research': return { agent: ROLES.research, needsOk: false, title: `Research up to ${action.count} prospects against the ICP`,
      text: `PIPELINE STEP: research\nFind up to ${action.count} real prospects that match the icp note in your COMPANY NOTES (and are not on its NOT-for list). Research only: contact no one.\n` +
        `Already in the pipeline or opted out — do not include: ${exclude.length ? exclude.join(', ') : 'none yet'}.\n` +
        'For every prospect, every claim must carry the URL where you read it. If you cannot point at a real page, leave the prospect out — an empty list is a correct answer.\n' +
        'End with exactly one fenced block:\n```prospects\n[{"company":"","domain":"","country":"","contact":{"name":null,"role":null,"email":null},"source":{"url":"","retrievedAt":"YYYY-MM-DD","publishedAt":null},"fitEvidence":[{"claim":"","url":""}],"trigger":null}]\n```\nIf you found none, output [] and say in one line what you searched and what would widen it.' };
    case 'qualify': return { agent: ROLES.qualify, needsOk: false, title: `Qualify ${action.keys.length} researched prospect${action.keys.length > 1 ? 's' : ''}`,
      text: `PIPELINE STEP: qualify\nDecide each prospect's fit against the icp note in your COMPANY NOTES, using ONLY the evidence below. Never a score. "yes" needs reasons; anything you would need but do not have goes in "missing" and makes it "unclear"; "no" needs the disqualifier.\n\n${action.keys.map(k => card(P(k))).join('\n\n')}\n\n` +
        'End with exactly one fenced block:\n```qualification\n[{"key":"","fit":"yes|no|unclear","reasons":[],"disqualifiers":[],"missing":[]}]\n```' };
    case 'draft': case 'followup': {
      const p = P(action.key), follow = action.step === 'followup';
      return { agent: follow ? ROLES.followup : ROLES.draft, needsOk: true, title: `${follow ? `Follow-up ${(p.followUps || 0) + 1}` : 'First touch'} to ${p.company}`,
        text: `PIPELINE STEP: ${action.step}\n${follow ? `Draft follow-up number ${(p.followUps || 0) + 1} to the first touch below. Short, no pressure, adds one useful thing.` : 'Draft one first touch.'} Open with ONE reason from the evidence below, quoted as found. One sentence on the problem we solve (icp note). One soft ask. We are new: claim no past work, results or clients. Prices only from offer-ladder, and only if asked.\n` +
          `First line: TO: ${p.contact?.name || '<name not found>'} <${p.contact?.email || 'email not found'}>. If there is no email, say so — the owner decides how to reach them.\nLast line: REASON: <the evidence URL you opened with> (a note to the office, never sent).\n\n${card(p)}` +
          (follow ? `\n\nWhat was sent before:\n${(p.outreach || []).filter(o => o.status === 'sent').map(o => `- ${new Date(o.sentAt).toISOString().slice(0, 10)}: task ${o.taskId}${o.remoteRef ? ' (ref ' + o.remoteRef + ')' : ''}`).join('\n')}` : '') };
    }
    case 'proposal': { const p = P(action.key);
      return { agent: ROLES.proposal, needsOk: true, title: `Proposal for ${p.company}`,
        text: `PIPELINE STEP: proposal\nDraft the proposal for ${p.company}, who said they are interested. Follow the proposal skill. Prices only from the offer-ladder note. What they told us: ${action.note || 'not recorded'}.\nThis is a proposal, not an agreement: nothing is agreed until the owner confirms it is signed.\n${termsText(config)}\n\n${card(p)}` }; }
    case 'delivery': { const p = P(action.key);
      return { agent: ROLES.delivery, needsOk: false, title: `Delivery plan for ${p.company}`,
        text: `PIPELINE STEP: delivery\n${p.company} signed (confirmed by the owner${action.note ? ': ' + action.note : ''}). Plan the start of delivery from the proposal that was sent (task ${p.proposal?.taskId || '?'}) and the services and delivery notes. Say what we need from the client, who does what in week one, and every gap the owner must decide. Contact no one.` }; }
  }
  return null;
}

/** Keep the pipeline in step with a task that belongs to it. Idempotent: the same task state is applied once. */
export function recordTask(pipeline, t, { now = Date.now() } = {}) {
  const step = t.pipeline?.step; if (!step) return null;
  const sig = [t.state, !!t.error, !!t.needsCheck, t.reconciled?.at || 0, t.waitingAt || 0, !!t.noop].join('|');
  pipeline.seen = pipeline.seen || {};
  if (pipeline.seen[t.id] === sig) return null;
  pipeline.seen[t.id] = sig;
  const run = { at: now, taskId: t.id, step, state: t.state };
  if (step === 'research' && t.state === 'done' && !t.error) {
    const b = parseBlock(t.result, 'prospects');
    if (b.error) Object.assign(run, { accepted: 0, problem: b.error });
    else { const r = acceptResearch(pipeline, b.value, { taskId: t.id, now }); Object.assign(run, { accepted: r.accepted.length, rejected: r.rejected }); if (!r.accepted.length) run.noop = `Research found no new eligible prospect${r.rejected.length ? ` (${r.rejected.length} rejected: ${r.rejected.map(x => `${x.company} — ${x.why}`).join('; ')})` : ''}.`; }
  } else if (step === 'qualify' && t.state === 'done' && !t.error) {
    const b = parseBlock(t.result, 'qualification');
    if (b.error) { run.problem = b.error; for (const k of t.pipeline.keys || []) { const p = pipeline.prospects.find(x => x.key === k); if (p?.stage === 'researched') move(p, 'needs-review', 'the qualification could not be read: ' + b.error, now); } }
    else Object.assign(run, applyQualification(pipeline, b.value.map(v => v), { taskId: t.id, now }));
  } else if (['draft', 'followup', 'proposal'].includes(step)) {
    const p = pipeline.prospects.find(x => x.key === t.pipeline.key); if (!p) return run;
    const kind = step === 'draft' ? 'first' : step;
    let o = (p.outreach || []).find(x => x.taskId === t.id);
    if (!o) { o = { taskId: t.id, kind, createdAt: now, status: 'drafting' }; p.outreach = [...(p.outreach || []), o]; }
    if (t.state === 'waiting') { Object.assign(o, { status: 'awaiting-approval', draftHash: t.draftHash, review: t.review?.verdict || null }); move(p, step === 'proposal' ? 'proposal-drafted' : step === 'draft' ? 'drafted' : p.stage, 'draft waiting for the owner', now); }
    else if (t.state === 'done' && t.noop) { o.status = 'nothing-to-send'; move(p, 'needs-review', 'the agent found nothing to send', now); }
    else if (t.state === 'done' && t.needsCheck) { o.status = 'unknown'; move(p, 'unknown', 'the send may or may not have gone out — the owner checks', now); }
    else if (t.state === 'done' && t.approved && !t.error) {
      const ref = (String(t.result || '').match(/^\s*REF:\s*(\S+)/im) || [])[1] || null;
      Object.assign(o, { status: 'sent', sentAt: t.reconciled?.at || t.doneAt || now, remoteRef: ref });
      if (step === 'proposal') { p.proposal = { taskId: t.id, sentAt: o.sentAt, remoteRef: ref }; move(p, 'proposal-sent', 'proposal sent after the owner approved', now); }
      else { if (step === 'followup') p.followUps = (p.followUps || 0) + 1; move(p, 'contacted', `${step === 'draft' ? 'first touch' : 'follow-up'} sent${ref ? ' (ref ' + ref + ')' : ' (no remote reference reported)'}`, now); }
    }
    else if (t.state === 'cancelled') { o.status = 'cancelled'; if (step !== 'followup') move(p, 'needs-review', 'the owner cancelled the draft', now); }
    else if (t.state === 'done' && t.error) o.status = 'failed';
  } else if (step === 'delivery' && t.state === 'done' && !t.error) {
    const p = pipeline.prospects.find(x => x.key === t.pipeline.key); if (p) p.deliveryPlan = { taskId: t.id, at: now };
  }
  pipeline.runs = [...(pipeline.runs || []), run].slice(-200);
  return run;
}

/** What the owner tells the workflow about a prospect. Returns { error } or { prospect, action? }. */
export function mark(pipeline, key, event, note = '', { now = Date.now() } = {}) {
  const p = pipeline.prospects.find(x => x.key === key);
  if (!p) return { error: 'no such prospect' };
  const say = s => s + (note ? ': ' + note : '');
  switch (event) {
    case 'opted-out': move(p, 'opted-out', say('asked not to be contacted'), now); p.optedOutAt = now; return { prospect: p };
    case 'replied': if (!['contacted', 'unknown'].includes(p.stage)) return { error: `a prospect at ${p.stage} has not been contacted` }; move(p, 'replied', say('replied'), now); return { prospect: p };
    case 'interested': if (!['contacted', 'replied'].includes(p.stage)) return { error: `a prospect at ${p.stage} cannot be marked interested` }; move(p, 'interested', say('interested'), now); return { prospect: p, action: { step: 'proposal', key, note } };
    case 'not-interested': move(p, 'lost', say('not interested'), now); return { prospect: p };
    case 'qualified': if (p.stage !== 'needs-review') return { error: 'only a prospect waiting for review can be qualified by hand' }; move(p, 'qualified', say('qualified by the owner'), now); return { prospect: p };
    case 'disqualified': move(p, 'disqualified', say('disqualified by the owner'), now); return { prospect: p };
    case 'signed':
      if (p.stage !== 'proposal-sent') return { error: 'a signed agreement follows a sent proposal — this prospect has no sent proposal. Won is never set off a guess.' };
      if (!note) return { error: 'say what was signed (e.g. "Growth retainer, signed 20 Sep, PDF in Drive")' };
      move(p, 'won', say('signed, confirmed by the owner'), now); p.wonAt = now; return { prospect: p, action: { step: 'delivery', key, note } };
    case 'lost': move(p, 'lost', say('lost'), now); return { prospect: p };
  }
  return { error: 'unknown event — opted-out, replied, interested, not-interested, qualified, disqualified, signed or lost' };
}

export function summary(pipeline, constraints) {
  const counts = {};
  for (const p of pipeline.prospects) counts[p.stage] = (counts[p.stage] || 0) + 1;
  const review = pipeline.prospects.filter(p => p.stage === 'needs-review').map(p => ({ key: p.key, company: p.company, why: p.history?.at(-1)?.why }));
  return { active: constraints.active, missing: constraints.missing, constraints: constraints.config, file: constraints.file, counts, review, prospects: pipeline.prospects, runs: (pipeline.runs || []).slice(-20) };
}
