// Where is the Claude Code binary?
//
// The office shells out to `claude` for every task, chat and `claude mcp list`. That works when
// the CLI is installed globally. It is NOT on PATH when Claude Code is installed only as the
// VS Code / Cursor extension, which ships its own binary inside the extension folder — so the
// office would report "Claude Code is not installed" on a machine that plainly has it.
//
// Order: AO_CLAUDE / office.config.json "claudePath"  →  PATH  →  the newest bundled extension
// binary. The extension folder carries its version in the name, so the scan picks the highest
// version rather than a hard-coded path that an update would break.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const EXT_ROOTS = [
  ['.vscode', 'extensions'], ['.vscode-insiders', 'extensions'], ['.vscode-server', 'extensions'],
  ['.cursor', 'extensions'], ['.windsurf', 'extensions'],
];
const BIN = process.platform === 'win32' ? 'claude.exe' : 'claude';

function onPath() {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8' });
  if (probe.status !== 0) return null;
  const hit = String(probe.stdout || '').split('\n').map(s => s.trim()).filter(Boolean)[0];
  return hit && fs.existsSync(hit) ? 'claude' : null; // on PATH: let the OS resolve it
}

function bundled() {
  const home = os.homedir();
  const found = [];
  for (const parts of EXT_ROOTS) {
    const dir = path.join(home, ...parts);
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (!/^anthropic\.claude-code-/i.test(name)) continue;
      const exe = path.join(dir, name, 'resources', 'native-binary', BIN);
      if (!fs.existsSync(exe)) continue;
      const v = (name.match(/(\d+)\.(\d+)\.(\d+)/) || []).slice(1).map(Number);
      found.push({ exe, rank: v.length === 3 ? v[0] * 1e6 + v[1] * 1e3 + v[2] : 0 });
    }
  }
  found.sort((a, b) => b.rank - a.rank);
  return found.length ? found[0].exe : null;
}

let cached = null;
/** The command to spawn. 'claude' when it is on PATH, otherwise an absolute path, or null. */
export function claudeBin(cfg = {}) {
  if (cached !== null) return cached;
  const explicit = process.env.AO_CLAUDE || cfg.claudePath;
  if (explicit && fs.existsSync(explicit)) return (cached = explicit);
  return (cached = onPath() || bundled() || null);
}
/** Spawn the CLI. A .mjs/.js "binary" (the tests' fake Claude, via AO_CLAUDE) runs under this Node,
 *  because Windows cannot execute a script file directly. */
export function spawnClaude(bin, args, opts) {
  if (/\.(mjs|cjs|js)$/i.test(bin || '')) return spawn(process.execPath, [bin, ...args], opts);
  return spawn(bin || 'claude', args, opts);
}
/** How the office found it, for the boot banner. */
export function claudeSource(cfg = {}) {
  const b = claudeBin(cfg);
  if (!b) return 'not found';
  if (b === 'claude') return 'on PATH';
  if (process.env.AO_CLAUDE || cfg.claudePath) return 'configured';
  return 'bundled with the editor extension';
}
