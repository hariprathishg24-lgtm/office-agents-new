// Agents Office — the agents learn from your corrections (Beta).
// Every time a deliverable is sent back ("revise: …" in the chat), the correction is written to
//   <brain>/Agents Office/feedback/<agent-id>.md
// Claude sorts it: a one-off about that task, or a standing rule that should apply every time.
// Standing rules are read by that agent before every task and chat turn. The file is yours:
// edit a rule, delete a line to unlearn it, move a line up to "Standing rules" to promote it.
import fs from 'node:fs';
import path from 'node:path';

export const dir = brainPath => path.join(brainPath, 'Agents Office', 'feedback');
const file = (brainPath, id) => path.join(dir(brainPath), id + '.md');
const MAX_RULES = 15; // the most recent standing rules an agent carries into a task
const HEAD = (a) => `# Corrections for ${a.name} (${a.id})\n\n` +
  'Every time the owner sends this agent\'s work back, the correction lands here. Lines under\n' +
  '"Standing rules" are read by this agent before every task and chat turn. Edit freely: reword a\n' +
  'rule, delete a line to unlearn it, move a one-off up to make it a rule. When a rule is really a\n' +
  'process, put it in a skill (SKILLS.md).\n\n## Standing rules\n\n## One-offs\n';

// A correction is not a policy until it has earned it. An owner's one-time "never do X" can be a
// passing remark about one draft; carried into every future task it quietly becomes a rule nobody
// decided. So a correction Claude reads as a standing rule lands under "Proposed rules" first, and
// is promoted to "Standing rules" only when the owner says the same thing again, or confirms it.
// A proposal that contradicts a standing rule is never promoted on its own — it names the rule it
// conflicts with and waits for the owner. Standing rules older than REVIEW_DAYS are flagged for review.
const REVIEW_DAYS = 180;
const STOP = new Set(['always', 'never', 'every', 'each', 'with', 'that', 'this', 'from', 'into', 'your', 'them', 'they', 'their', 'what', 'when', 'dont', 'should', 'must', 'make', 'sure', 'keep', 'avoid', 'stop', 'only']);
const words = s => new Set(String(s).toLowerCase().replace(/←.*$/, '').replace(/^\d{4}-\d{2}-\d{2}\s*·\s*/, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)));
const jaccard = (a, b) => { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / (A.size + B.size - n); };
const negative = s => /\b(never|don'?t|do not|no|avoid|stop|without|not)\b/i.test(String(s).replace(/←.*$/, ''));
export const similar = (a, b) => jaccard(a, b) >= 0.6 && negative(a) === negative(b); // the same words with the opposite sense is a conflict, never a repeat
export const conflicts = (a, b) => jaccard(a, b) >= 0.4 && negative(a) !== negative(b);
const ruleText = line => String(line).replace(/^\d{4}-\d{2}-\d{2}\s*·\s*/, '').replace(/\s*←.*$/, '').replace(/\s*⚠.*$/, '').trim();

/** Read the file → { rules, proposed, oneOffs, reviewDue } (each a line without the leading "- "). */
export function read(brainPath, id) {
  const p = file(brainPath, id); if (!fs.existsSync(p)) return { rules: [], proposed: [], oneOffs: [], reviewDue: [] };
  const out = { rules: [], proposed: [], oneOffs: [], reviewDue: [] }; let sec = null;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (/^##\s+standing rules/i.test(line)) { sec = 'rules'; continue; }
    if (/^##\s+proposed rules/i.test(line)) { sec = 'proposed'; continue; }
    if (/^##\s+one-offs/i.test(line)) { sec = 'oneOffs'; continue; }
    if (/^##?\s/.test(line)) { sec = null; continue; }
    const m = line.match(/^\s*[-*]\s+(.+)$/); if (m && sec) out[sec].push(m[1].trim());
  }
  const now = Date.now();
  out.reviewDue = out.rules.filter(r => { const d = Date.parse((r.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1]); return d && now - d > REVIEW_DAYS * 864e5; });
  return out;
}

function sectionEdit(text, heading, fn) { // fn(lines) → lines, for the bullet lines of one "## heading" section
  if (!new RegExp(`^## ${heading}`, 'm').test(text)) text = text.replace(/\s*$/, '\n') + `\n## ${heading}\n`;
  const m = text.match(new RegExp(`^## ${heading}[^\\n]*\\n`, 'm'));
  const start = m.index + m[0].length; const rest = text.slice(start); const next = rest.search(/^## /m);
  const end = next < 0 ? text.length : start + next;
  const body = text.slice(start, end);
  const bullets = body.split(/\r?\n/).filter(l => /^\s*[-*]\s+/.test(l));
  const kept = fn(bullets.map(l => l.replace(/^\s*[-*]\s+/, '')));
  return text.slice(0, start) + (kept.length ? '\n' + kept.map(l => '- ' + l).join('\n') + '\n' : '\n') + (end < text.length ? '\n' + text.slice(end) : '');
}
function ensureSections(text) {
  if (!/^## Standing rules/m.test(text)) text += '\n## Standing rules\n';
  if (!/^## Proposed rules/m.test(text)) text = text.replace(/^## One-offs/m, '## Proposed rules\n\n## One-offs');
  if (!/^## Proposed rules/m.test(text)) text += '\n## Proposed rules\n';
  if (!/^## One-offs/m.test(text)) text += '\n## One-offs\n';
  return text;
}

/**
 * Record one correction. `verdict` = { standing, rule } from classify(), or null when Claude was unavailable.
 * → { standing, proposed, promoted, duplicate, conflict, line, path }
 */
export function record(brainPath, agent, task, feedback, verdict) {
  fs.mkdirSync(dir(brainPath), { recursive: true });
  const p = file(brainPath, agent.id);
  let text = ensureSections(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : HEAD(agent));
  const date = new Date().toISOString().slice(0, 10);
  const quote = String(feedback).replace(/\s+/g, ' ').trim().slice(0, 160);
  const ctx = task?.title ? ` (${String(task.title).slice(0, 60)})` : '';
  const out = { standing: false, proposed: false, promoted: false, duplicate: false, conflict: null, path: p };
  if (!(verdict && verdict.standing && verdict.rule)) {
    out.line = `${date} · "${quote}"${ctx}`;
    text = sectionEdit(text, 'One-offs', l => [...l, out.line]);
  } else {
    const rule = String(verdict.rule).replace(/\s+/g, ' ').trim().slice(0, 240);
    const cur = { rules: [], proposed: [] };
    sectionEdit(text, 'Standing rules', l => (cur.rules = l, l)); sectionEdit(text, 'Proposed rules', l => (cur.proposed = l, l));
    out.line = `${date} · ${rule} ← "${quote}"${ctx}`;
    out.conflict = cur.rules.find(r => conflicts(rule, ruleText(r))) || cur.proposed.find(r => conflicts(rule, ruleText(r))) || null;
    if (cur.rules.some(r => similar(rule, ruleText(r)))) out.duplicate = out.standing = true; // already a rule: nothing new
    else {
      const again = cur.proposed.findIndex(r => similar(rule, ruleText(r)));
      if (again >= 0 && !out.conflict) { // said twice: it has earned a place
        const first = cur.proposed[again];
        text = sectionEdit(text, 'Proposed rules', l => l.filter((_, i) => i !== again));
        text = sectionEdit(text, 'Standing rules', l => [...l, `${first.replace(/\s*⚠.*$/, '')} · repeated ${date} ← "${quote}"${ctx}`]);
        out.standing = out.promoted = true;
      } else {
        text = sectionEdit(text, 'Proposed rules', l => [...l, out.line + (out.conflict ? ` ⚠ conflicts with: "${ruleText(out.conflict)}"` : '')]);
        out.proposed = true;
      }
    }
  }
  fs.writeFileSync(p, text);
  return out;
}
/** The owner confirms a proposed rule (index into read().proposed): it becomes a standing rule. */
export function confirm(brainPath, agent, index, { replaceConflicting = false } = {}) {
  const p = file(brainPath, agent.id); if (!fs.existsSync(p)) return { error: 'no corrections for this agent' };
  let text = ensureSections(fs.readFileSync(p, 'utf8'));
  const { proposed, rules } = read(brainPath, agent.id);
  const line = proposed[index]; if (!line) return { error: 'no such proposed rule' };
  const rule = ruleText(line), clash = rules.find(r => conflicts(rule, ruleText(r)));
  if (clash && !replaceConflicting) return { error: `it conflicts with the standing rule "${ruleText(clash)}" — confirm with replaceConflicting to replace that rule`, conflict: clash };
  text = sectionEdit(text, 'Proposed rules', l => l.filter((_, i) => i !== index));
  text = sectionEdit(text, 'Standing rules', l => [...l.filter(r => !(clash && r === clash)), `${line.replace(/\s*⚠.*$/, '')} · confirmed by the owner ${new Date().toISOString().slice(0, 10)}`]);
  fs.writeFileSync(p, text);
  return { confirmed: rule, replaced: clash ? ruleText(clash) : null };
}
/** The owner drops a proposed rule: it moves to one-offs, where it informs nothing. */
export function dismiss(brainPath, agent, index) {
  const p = file(brainPath, agent.id); if (!fs.existsSync(p)) return { error: 'no corrections for this agent' };
  let text = ensureSections(fs.readFileSync(p, 'utf8'));
  const line = read(brainPath, agent.id).proposed[index]; if (!line) return { error: 'no such proposed rule' };
  text = sectionEdit(text, 'Proposed rules', l => l.filter((_, i) => i !== index));
  text = sectionEdit(text, 'One-offs', l => [...l, `${line.replace(/\s*⚠.*$/, '')} · not a rule (owner) ${new Date().toISOString().slice(0, 10)}`]);
  fs.writeFileSync(p, text);
  return { dismissed: ruleText(line) };
}

/** Ask Claude whether a correction is a one-off or a standing rule. `ask(system, user)` → text. */
export async function classify(ask, agent, task, feedback) {
  const system = 'You sort an owner\'s feedback on an AI agent\'s work. Return ONLY a JSON object, no prose, no code fences.';
  const user = `Agent: ${agent.name} — ${agent.role}. ${agent.does}\nTask: ${task?.title || ''}\nOwner's feedback: "${feedback}"\n\n` +
    'Is this a ONE-OFF (about this task, this client, this draft only) or a STANDING RULE (a preference the owner will want applied to every future piece of this kind of work)?\n' +
    'Signals of a standing rule: "always", "never", "from now on", "we don\'t", a format or tone preference, a red line. Signals of a one-off: a fact about this client, a change to this draft only, "this time", "here".\n' +
    'Return: {"standing": true|false, "rule": "<if standing: the preference as ONE short imperative sentence, general, no client or project names; else empty string>"}';
  try {
    const j = JSON.parse((await ask(system, user, { maxTokens: 200, timeout: 60000 })).replace(/```json|```/g, '').trim());
    return { standing: !!j.standing && !!j.rule, rule: String(j.rule || '').trim() };
  } catch { return null; }
}

/** The block for an agent's system prompt: its standing rules, newest last. */
export function promptText(brainPath, agent) {
  const { rules } = read(brainPath, agent.id); if (!rules.length) return '';
  const recent = rules.slice(-MAX_RULES).map(r => '- ' + r.replace(/^\d{4}-\d{2}-\d{2}\s*·\s*/, '').replace(/\s*←\s*".*$/, ''));
  return 'LESSONS — what the owner corrected before. Apply every one of these, every time, without being asked:\n' + recent.join('\n');
}
export const count = (brainPath, id) => read(brainPath, id).rules.length;
