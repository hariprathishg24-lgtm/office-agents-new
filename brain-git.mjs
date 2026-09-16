// The brain is the company's memory, and agents write into it on every task. Without history a
// single bad write is unrecoverable, so the office keeps the vault in its own git repo and commits
// after each change. Nothing is ever pushed anywhere — this is a local undo history.
//
//   ensureRepo(path)        once at boot: git init + an initial commit if needed
//   snapshot('why')         commit whatever changed, debounced; safe to call on every write
//   history(n)              what changed and when
//
// Every git call is best-effort: if git is missing or the repo is odd, the office warns once and
// carries on. Losing history must never stop the agents working.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SEP = String.fromCharCode(31); // unit separator, for parsing git log safely
let root = null, ok = false, warned = false, pending = null, lastCommit = 0;

const git = (args, cwd = root) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });

function warnOnce(msg) {
  if (warned) return;
  warned = true;
  console.warn('  ⚠ brain history off:', msg, '— agent writes will not be recoverable');
}

export function ensureRepo(brainPath) {
  root = brainPath;
  try {
    if (!fs.existsSync(root)) return false;
    if (git(['--version'], process.cwd()).status !== 0) { warnOnce('git not found'); return false; }
    if (git(['rev-parse', '--is-inside-work-tree']).status !== 0) {
      if (git(['init', '-q']).status !== 0) { warnOnce('could not init a repo here'); return false; }
      fs.writeFileSync(path.join(root, '.gitignore'), '.DS_Store\nThumbs.db\n');
      git(['add', '-A']);
      git(['-c', 'user.name=Agents Office', '-c', 'user.email=office@localhost',
           'commit', '-q', '-m', 'brain: initial snapshot']);
    }
    ok = true;
    return true;
  } catch (e) { warnOnce(e.message.split('\n')[0]); return false; }
}

/** Commit whatever changed. Debounced, so a burst of writes becomes one commit. */
export function snapshot(reason = 'agent write', { now = false } = {}) {
  if (!ok) return;
  clearTimeout(pending);
  const run = () => {
    try {
      if (!git(['status', '--porcelain']).stdout.trim()) return; // nothing changed
      git(['add', '-A']);
      const r = git(['-c', 'user.name=Agents Office', '-c', 'user.email=office@localhost',
                     'commit', '-q', '-m', String(reason).slice(0, 140)]);
      if (r.status === 0) lastCommit = Date.now();
    } catch (e) { warnOnce(e.message.split('\n')[0]); }
  };
  if (now) run(); else pending = setTimeout(run, 2500);
}

/** The last n changes: [{ hash, when, what }] */
export function history(n = 20) {
  if (!ok) return [];
  const out = git(['log', '-n', String(n), '--pretty=%h' + SEP + '%ct' + SEP + '%s']);
  if (out.status !== 0) return [];
  return out.stdout.trim().split('\n').filter(Boolean).map(l => {
    const [hash, ts, what] = l.split(SEP);
    return { hash, when: +ts * 1000, what };
  });
}

export const enabled = () => ok;
export const lastAt = () => lastCommit;
