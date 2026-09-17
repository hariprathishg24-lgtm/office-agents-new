// Agents Office — running continuously (Phase 8 of the reliability handoff).
//
//   causeOf(message)      what kind of failure a run hit: login · rate-limit · network · timeout · spawn · other
//   problems(...)         the states the owner must know about, in plain words: an expired Claude
//                         login, a machine that looks offline, a usage limit, repeated timeouts, the
//                         machine having slept through its routines
//   acquireLock / release one office per data folder — two servers on the same tasks.json would run
//                         the same work twice
//   freshness(...)        how long since each core note was last changed
import fs from 'node:fs';
import path from 'node:path';

const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;

export function causeOf(message = '', phase = '') {
  const m = String(message);
  if (phase === 'spawn' || /not installed|could not start claude|ENOENT/i.test(m)) return 'spawn';
  if (/\b(401|403)\b|unauthori[sz]ed|authenticat|not logged in|log ?in|oauth|expired token|token (has )?expired|invalid api key|credential/i.test(m)) return 'login';
  if (/\b429\b|rate.?limit|usage limit|overloaded|quota|too many requests/i.test(m)) return 'rate-limit';
  if (/ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|getaddrinfo|network|fetch failed|socket hang up|offline/i.test(m)) return 'network';
  if (phase === 'timeout' || /took longer than/i.test(m)) return 'timeout';
  return 'other';
}

/** Problems the owner should see now. tasks: the store · sleeps: [{from,to}] · usage: the gauge value or null. */
export function problems({ tasks = [], sleeps = [], usage = null, ceiling = 85, now = Date.now(), claudeFound = true }) {
  const out = [];
  if (!claudeFound) out.push({ kind: 'spawn', severity: 'high', text: 'Claude Code was not found on this machine, so no task can run. Install the CLI or set "claudePath" in office.config.json.' });
  const recent = tasks.flatMap(t => (t.attempts || []).filter(a => a.outcome && a.outcome !== 'ok' && a.outcome !== 'interrupted' && (a.endedAt || 0) > now - 2 * HOUR).map(a => ({ t, a, cause: a.cause || causeOf(a.error, a.phase) })));
  const by = c => recent.filter(r => r.cause === c);
  const since = list => new Date(Math.min(...list.map(r => r.a.endedAt))).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (by('login').length) out.push({ kind: 'login', severity: 'high', text: `Claude's login looks expired or invalid: ${by('login').length} run${by('login').length > 1 ? 's' : ''} failed with an authentication error since ${since(by('login'))}. Open a terminal, run \`claude\` and log in again. Nothing is retried automatically.` });
  if (by('network').length) out.push({ kind: 'network', severity: 'high', text: `This machine looks offline: ${by('network').length} run${by('network').length > 1 ? 's' : ''} could not reach the network since ${since(by('network'))}.` });
  if (by('rate-limit').length) out.push({ kind: 'rate-limit', severity: 'medium', text: `Claude refused ${by('rate-limit').length} run${by('rate-limit').length > 1 ? 's' : ''} for usage or load since ${since(by('rate-limit'))}. Wait for the window to reset.` });
  if (by('spawn').length) out.push({ kind: 'spawn', severity: 'high', text: `Claude Code could not be started for ${by('spawn').length} run${by('spawn').length > 1 ? 's' : ''}: ${by('spawn').at(-1).a.error}` });
  if (by('timeout').length >= 2) out.push({ kind: 'timeout', severity: 'medium', text: `${by('timeout').length} runs timed out in the last two hours. The last one: ${by('timeout').at(-1).a.error}` });
  const pct = usage?.session?.percent;
  if (typeof pct === 'number' && pct >= ceiling) out.push({ kind: 'usage', severity: 'medium', text: `Claude plan session at ${pct}% (ceiling ${ceiling}%): routines are held until the window resets.` });
  for (const s of sleeps.filter(s => s.to > now - DAY)) out.push({ kind: 'sleep', severity: 'low', text: `The office was not running (asleep or off) from ${new Date(s.from).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })} to ${new Date(s.to).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Routines due in that time ran once, late.` });
  return out;
}

export const lockFile = dataDir => path.join(dataDir, 'office.lock');
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
/**
 * Take the data folder's lock. If another office holds it — its process is alive AND it answers on
 * its port — refuse. A lock left by a killed process (or a reused pid that is not an office) is taken over.
 */
export async function acquireLock(dataDir, { port, host = '127.0.0.1', pid = process.pid, now = Date.now() }) {
  const file = lockFile(dataDir);
  let held = null; try { held = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  if (held && held.pid !== pid && alive(held.pid)) {
    try {
      const r = await fetch(`http://${held.host || '127.0.0.1'}:${held.port}/api/health`, { signal: AbortSignal.timeout(2000) });
      const h = r.ok ? await r.json() : null;
      if (h?.instance?.pid === held.pid) return { ok: false, holder: held };
    } catch {}
  }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ pid, port, host, startedAt: now, tookOverFrom: held && held.pid !== pid ? held.pid : undefined }));
  return { ok: true, tookOver: held && held.pid !== pid ? held : null };
}
export function releaseLock(dataDir, pid = process.pid) {
  try { const held = JSON.parse(fs.readFileSync(lockFile(dataDir), 'utf8')); if (held.pid === pid) fs.unlinkSync(lockFile(dataDir)); } catch {}
}

/** Age of each note in `names`, from an index with .meta (serve.mjs vaultIndex). */
export function freshness(index, names, { now = Date.now(), staleDays = 60 } = {}) {
  return names.filter(n => index.has(n)).map(n => {
    let modified = null; try { modified = fs.statSync(index.meta.get(n).path).mtimeMs; } catch {}
    const days = modified ? Math.floor((now - modified) / DAY) : null;
    return { note: n, modified: modified ? new Date(modified).toISOString() : null, days, stale: days !== null && days > staleDays };
  });
}
