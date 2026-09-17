// Agents Office — state on disk that survives a crash mid-write.
//
// The office used to fs.writeFileSync straight over data/tasks.json and read it back with
// `catch { return [] }`. Two failures followed from that: a crash in the middle of a write left a
// half-written file, and the next read of that file silently became "no tasks", which the next
// save then wrote back over the damaged file. Pending approvals and the record of what was sent
// were gone with no trace.
//
//   writeJSON(file, value)  write to a temp file, keep the previous good copy as <file>.bak, rename
//                           over the original (rename is atomic on the same volume)
//   readJSON(file, fallback) missing → fallback · readable → value · damaged → the damaged file is
//                           kept as <file>.corrupt-<time>, the .bak is used if it reads, otherwise a
//                           StoreError is thrown so no caller can mistake damage for "empty"
import fs from 'node:fs';
import path from 'node:path';

export class StoreError extends Error {
  constructor(message, file) { super(message); this.name = 'StoreError'; this.file = file; }
}

const notices = new Set();
const warnOnce = (key, msg) => { if (notices.has(key)) return; notices.add(key); console.warn(msg); };

function renameRetry(from, to) {
  // Windows: a reader (antivirus, the indexer, an editor) can hold the target open for a moment
  for (let i = 0; ; i++) {
    try { return fs.renameSync(from, to); } catch (e) {
      if (i >= 8 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
      const until = Date.now() + 25 * (i + 1); while (Date.now() < until) { /* short, bounded wait */ }
    }
  }
}

export function writeJSON(file, value, { pretty = true } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = JSON.stringify(value, null, pretty ? 2 : 0);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  try {
    // keep the last copy that parsed, so a bad write can always be walked back one step
    if (fs.existsSync(file)) { try { JSON.parse(fs.readFileSync(file, 'utf8')); fs.copyFileSync(file, file + '.bak'); } catch {} }
    renameRetry(tmp, file);
  } catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; }
}

export function readJSON(file, fallback) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw new StoreError(`cannot read ${file}: ${e.message}`, file);
  }
  try { return JSON.parse(text); } catch (e) {
    const kept = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    if (!notices.has('kept:' + file)) { try { fs.copyFileSync(file, kept); } catch {} }
    warnOnce('kept:' + file, `  ✗ ${path.basename(file)} is damaged (${e.message}) — the damaged copy is kept as ${path.basename(kept)}`);
    try {
      const bak = JSON.parse(fs.readFileSync(file + '.bak', 'utf8'));
      warnOnce('bak:' + file, `  ↺ using the last good copy, ${path.basename(file)}.bak — anything written after it is in the damaged copy`);
      return bak;
    } catch {
      throw new StoreError(`${path.basename(file)} is damaged and there is no readable backup — the office will not overwrite it. Repair or move ${file} and restart.`, file);
    }
  }
}
