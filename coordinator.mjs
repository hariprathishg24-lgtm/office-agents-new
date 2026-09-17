// Agents Office — coordination across roles (Phase 7 of the reliability handoff).
//
// The pure rules the server applies around a task: what it waits on, when it may start, what an
// agent's result asks of other agents or of the owner, what the reviewer said, and which decisions
// are waiting on the owner. No I/O here; serve.mjs owns the store and the Claude calls.
//
// States a task can be in (existing four, plus three):
//   next · doing · waiting · done     as before
//   blocked     waits for its prerequisites (task.after) — never started while any is unfinished or failed
//   review      an independent reviewer is reading the draft before the owner sees it
//   cancelled   stopped by the owner; kept with its history, never run again

export const MAX_HANDOFFS = 3;       // new tasks one result may create
export const MAX_DEPTH = 3;          // a handoff of a handoff of a handoff, and no further
export const TERMINAL = ['done', 'cancelled'];

/** Where a task stands against its prerequisites. */
export function prerequisites(t, byId) {
  const after = Array.isArray(t.after) ? t.after : [];
  const waitingOn = [], failed = [];
  for (const id of after) {
    const p = byId.get(id);
    if (!p) { failed.push({ id, why: 'no longer exists' }); continue; }
    if (p.state === 'cancelled') failed.push({ id, why: 'was cancelled' });
    else if (p.state === 'done' && p.needsCheck) failed.push({ id, why: 'has an unknown outcome' });
    else if (p.state === 'done' && p.error) failed.push({ id, why: 'failed' });
    else if (p.state !== 'done') waitingOn.push(id);
  }
  return { ready: !waitingOn.length && !failed.length, waitingOn, failed };
}

/**
 * Re-check every blocked task. Returns the ids that became runnable. A failed prerequisite keeps the
 * dependent blocked, with the reason written on it: nothing downstream runs on a broken input.
 */
export function unblock(list) {
  const byId = new Map(list.map(t => [t.id, t]));
  const started = [];
  for (const t of list) {
    if (t.state !== 'blocked') continue;
    const p = prerequisites(t, byId);
    if (p.ready) { t.state = 'next'; t.because = 'prerequisites finished'; delete t.blockedReason; started.push(t.id); continue; }
    const reason = p.failed.length
      ? `blocked: ${p.failed.map(f => `"${byId.get(f.id)?.title || f.id}" ${f.why}`).join('; ')} — fix or cancel it, or remove it from this task's prerequisites`
      : `waiting for ${p.waitingOn.map(id => `"${byId.get(id)?.title || id}"`).join(', ')}`;
    if (t.blockedReason !== reason) { t.blockedReason = reason; if (p.failed.length) t.because = 'prerequisite failed'; }
  }
  return started;
}

/** The state a new task starts in, given what it waits on. */
export function initialState(after, list) {
  if (!after?.length) return 'next';
  const probe = { after };
  return prerequisites(probe, new Map(list.map(t => [t.id, t]))).ready ? 'next' : 'blocked';
}

/**
 * Structured requests at the end of a result:
 *   HANDOFF → <agent id>: <what they need to do>     (also -> or =>)
 *   NEEDS OWNER: <the decision or fact only the owner has>
 */
export function parseRequests(text, agentIds) {
  const handoffs = [], owner = [], refused = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/^[\s>*\-•]+/, '').replace(/\*\*/g, '').trim();
    let m = line.match(/^HANDOFF\s*(?:→|->|=>|to)\s*([a-z0-9_-]+)\s*:\s*(.+)$/i);
    if (m) {
      const id = m[1].toLowerCase();
      if (!agentIds.includes(id)) refused.push(`${id}: not an agent on the roster`);
      else if (handoffs.length >= MAX_HANDOFFS) refused.push(`${id}: more than ${MAX_HANDOFFS} handoffs from one result`);
      else handoffs.push({ agent: id, text: m[2].trim().slice(0, 1500) });
      continue;
    }
    m = line.match(/^NEEDS OWNER\s*:\s*(.+)$/i);
    if (m) owner.push(m[1].trim().slice(0, 400));
  }
  return { handoffs, owner, refused };
}

/** The reviewer's answer: the first VERDICT line decides; anything unreadable is not a pass. */
export function parseVerdict(text) {
  const s = String(text || '');
  const m = s.match(/VERDICT\s*:\s*\**\s*(PASS|FAIL)/i);
  const notes = s.replace(/^.*VERDICT\s*:.*$/im, '').trim().slice(0, 2000);
  return { verdict: m ? m[1].toUpperCase() : 'UNCLEAR', notes };
}

/**
 * Everything waiting on the owner, each item saying what decision is needed, not dumping a log.
 * failures: tasks that failed in the last day (repeated failures of one routine are grouped).
 */
export function pending(list, { paused = null, now = Date.now(), agentName = id => id } = {}) {
  const out = [];
  const who = t => agentName(t.agent);
  for (const t of list) {
    if (t.state === 'waiting') {
      const flagged = t.review && t.review.verdict !== 'PASS' && t.review.draftHash === t.draftHash;
      out.push({ kind: 'approval', id: t.id, agent: t.agent, title: t.title, since: t.waitingAt || t.changedAt || null,
        decision: `Approve or reject ${who(t)}'s draft "${t.title}".${flagged ? ` The reviewer ${t.review.verdict === 'FAIL' ? 'FAILED it' : 'could not confirm it'} — read its notes first.` : t.review?.verdict === 'PASS' ? ' The reviewer passed it.' : ''}`, review: t.review || null });
    }
    if (t.state === 'done' && t.needsCheck) out.push({ kind: 'unknown-outcome', id: t.id, agent: t.agent, title: t.title, since: t.doneAt || null,
      decision: `Check whether "${t.title}" actually went out (sent folder, post, record). It was not retried. Then mark it checked.` });
    if (t.state === 'blocked' && /^blocked:/.test(t.blockedReason || '')) out.push({ kind: 'blocked', id: t.id, agent: t.agent, title: t.title,
      decision: `"${t.title}" cannot start: ${t.blockedReason.replace(/^blocked:\s*/, '')}.` });
    for (const q of (t.needsOwner || []).filter(q => !q.answered)) out.push({ kind: 'question', id: t.id, agent: t.agent, title: t.title, since: q.at || null,
      decision: `${who(t)} needs from you: ${q.text}` });
    if (t.filed === 'failed') out.push({ kind: 'filing', id: t.id, agent: t.agent, title: t.title,
      decision: `"${t.title}" is done but its note was not saved (${t.noteError}). The work does not need redoing; fix the brain folder.` });
  }
  const day = list.filter(t => t.state === 'done' && t.error && !t.needsCheck && now - (t.doneAt || 0) < 864e5);
  const groups = new Map();
  for (const t of day) { const k = t.routine || t.id; groups.set(k, [...(groups.get(k) || []), t]); }
  for (const [, ts] of groups) {
    const t = ts[ts.length - 1];
    const cause = /auth|login|credential|unauthori[sz]ed|not connected|expired/i.test(t.result || '') ? ' It looks like a login or connector problem.' : /took longer than/i.test(t.result || '') ? ' It timed out.' : '';
    out.push({ kind: ts.length > 1 ? 'repeated-failure' : 'failure', id: t.id, agent: t.agent, title: t.title, since: t.doneAt,
      decision: `${ts.length > 1 ? `"${t.title}" failed ${ts.length} times today` : `"${t.title}" failed`}: ${String(t.result || '').replace(/^Could not complete this task:\s*/, '').split('\n')[0].slice(0, 200)}.${cause}` });
  }
  const order = ['unknown-outcome', 'approval', 'question', 'repeated-failure', 'blocked', 'failure', 'filing'];
  out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (a.since || 0) - (b.since || 0));
  return { paused, count: out.length, items: out };
}

/** Record every state change with its reason, comparing against what was on disk. */
export function stampHistory(list, previous, now = Date.now()) {
  const prev = new Map((previous || []).map(t => [t.id, t.state]));
  for (const t of list) {
    const was = prev.has(t.id) ? prev.get(t.id) : null;
    if (was !== t.state) {
      t.history = [...(t.history || []), { at: now, from: was, to: t.state, why: t.because || null }].slice(-60);
      t.changedAt = now;
    }
    delete t.because;
  }
  return list;
}
