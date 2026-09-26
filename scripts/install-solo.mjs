import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.mjs';
import { loadRoster } from '../roster.mjs';
import { file, validate } from '../routines.mjs';
import { groups, workflows, routineFor } from '../solo.mjs';

// Merge only new IDs. Re-running never resets schedules, user edits, or paused state.
export function install(brain, agents) {
  const location = file(brain);
  const document = fs.existsSync(location) ? JSON.parse(fs.readFileSync(location, 'utf8')) : { routines: [] };
  const current = Array.isArray(document) ? document : document.routines;
  if (!Array.isArray(current)) throw new Error('Existing routine document is invalid; nothing replaced.');
  const additions = workflows.filter(w => !current.some(r => r.id === w.id)).map(routineFor);
  const accepted = [...current];
  for (const r of additions) {
    const result = validate(r, agents, accepted);
    if (result.problems.length) throw new Error(result.problems.join('\n'));
    accepted.push(r);
  }
  const plans = [];
  for (const group of groups) {
    const members = workflows.filter(w => w.group === group.id);
    const ids = [...new Set(members.map(w => w.agent))];
    const content = `---\nname: solo-${group.id}\ndescription: Digital-services operating procedures for ${group.title.toLowerCase()}; applies only to solo workflow tasks.\nagents: [${ids.join(', ')}]\n---\n# ${group.title}\nUse only when the task explicitly names a solo workflow below.\nRead the task's required inputs and available company records. Missing sources are a blocker, not evidence of zero activity. Distinguish verified facts, estimates, proposals and unknowns. Cite source records and dates. These workflows produce reports and drafts only; they do not authorize external actions or agent handoffs. Existing business policies remain authoritative.\n\n${members.map(w => `## ${w.id}: ${w.title}\nInputs: ${w.inputs}.\nProcedure: ${w.procedure}\nOutput: ${w.output}.\n`).join('\n')}\nEnd with: missing inputs, decisions needed, and recommended next step. Never describe a proposal as executed.\n`;
    if (content.length > 6000) throw new Error(`Skill too long: ${group.id}`);
    plans.push({ filename: path.join(brain, 'Agents Office', 'skills', `solo-${group.id}`, 'SKILL.md'), content });
  }
  fs.mkdirSync(path.dirname(location), { recursive: true });
  if (additions.length) {
    if (fs.existsSync(location)) fs.copyFileSync(location, `${location}.backup-${Date.now()}`);
    const next = Array.isArray(document) ? accepted : { ...document, routines: accepted };
    fs.writeFileSync(location + '.solo-tmp', JSON.stringify(next, null, 2) + '\n');
    fs.renameSync(location + '.solo-tmp', location);
  }
  let skills = 0;
  for (const plan of plans) {
    if (fs.existsSync(plan.filename)) continue;
    fs.mkdirSync(path.dirname(plan.filename), { recursive: true });
    fs.writeFileSync(plan.filename, plan.content); skills++;
  }
  return { added: additions.length, skills, workflows: workflows.length, paused: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(install(loadConfig().brainPath, loadRoster().agents)));
}
