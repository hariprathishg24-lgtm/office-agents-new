// Agents Office — connectors (Beta). The office shows the MCP servers YOUR Claude Code is
// actually connected to, and hands those same servers to the agents as tools.
//
//   discover()          → `claude mcp list`, parsed: every server, its status, the tool id
//   fromInit(servers)   → refresh statuses from a run's `system init` event (free, every task)
//   allowedTools()      → the --allowedTools list an agent gets (connected · allow/deny · web)
//   summary()           → what /api/mcp returns and what the top bar draws
//
// office.config.json →  "mcp": { "allow": [], "deny": [], "departments": { "<server>": ["sales"] } }
//   allow  — empty = every connected server; otherwise only these (name, id or key)
//   deny   — servers the agents may see in the bar but never call
//   departments — which pods a server is wired to (default: a built-in map, else every pod)
import fs from 'node:fs';
import { claudeBin, spawnClaude } from './claude-bin.mjs';

export const DEPT_KEYS = ['emails', 'sales', 'marketing', 'ops', 'fin', 'delivery', 'creative', 'success', 'risk', 'growth', 'exec',
  'eng', 'data', 'pmo', 'people', 'legal', 'support', 'procure', 'expand', 'product'];

// known brands → logo key in src/mcplogos.js. Anything else gets a generated tile.
const ALIASES = {
  gmail: ['gmail', 'googlegmail'], notion: ['notion'], canva: ['canva'], meta: ['metaads', 'meta', 'facebookads', 'facebook'],
  slack: ['slack'], fullenrich: ['fullenrich'], apollo: ['apollo', 'apolloio'], xero: ['xero'], stripe: ['stripe'],
  pandadoc: ['pandadoc'], clarity: ['clarity', 'microsoftclarity'], beehiiv: ['beehiiv'], loops: ['loops'],
  hyperframes: ['hyperframes'], imessage: ['imessage', 'messages'], claude: ['claude'], chatgpt: ['chatgpt', 'openai'],
  googlecalendar: ['googlecalendar', 'gcal', 'calendar'], googledrive: ['googledrive', 'gdrive', 'drive'], webflow: ['webflow'], playwright: ['playwright'],
  higgsfield: ['higgsfield', 'higgfield'], territool: ['territool'],
};
// which pods a known brand feeds (mirrors the demo's MCP_BY_DEPT)
const DEPTS_BY_KEY = {
  meta: ['marketing'], canva: ['marketing', 'delivery', 'creative'], loops: ['marketing'], beehiiv: ['marketing'], hyperframes: ['marketing'],
  clarity: ['marketing'], notion: DEPT_KEYS, gmail: ['emails', 'sales', 'ops', 'fin', 'delivery', 'success'],
  fullenrich: ['sales'], imessage: ['sales'], apollo: ['sales'], pandadoc: ['ops', 'delivery', 'legal', 'procure'], xero: ['fin'], stripe: ['fin'],
  slack: ['emails', 'ops', 'delivery'], googledrive: ['ops', 'delivery', 'fin', 'creative', 'success'], googlecalendar: ['emails', 'sales', 'delivery', 'success'],
  playwright: ['marketing', 'ops'], github: ['ops', 'delivery', 'eng', 'data', 'product'], linear: ['ops', 'delivery', 'eng', 'pmo'], jira: ['ops', 'delivery', 'eng', 'pmo'],
  hubspot: ['sales', 'marketing', 'success'], salesforce: ['sales'], zapier: DEPT_KEYS, figma: ['marketing', 'delivery', 'creative'],
  webflow: ['marketing', 'delivery'], higgsfield: ['marketing'], territool: ['sales'],
  // V4: risk/growth/exec are deliberately left off every brand's list above — they're synthesis/
  // register-keeping depts (mostly notion, which is DEPT_KEYS-wide already); the DEPTS_BY_KEY
  // fallback (every pod) only kicks in for a genuinely unknown connector, which is fine here too.
};

export const norm = s => String(s).toLowerCase().replace(/^claude\.ai\s+/, '').replace(/\s+mcp$/, '').replace(/[^a-z0-9]/g, '');
export const toolId = name => String(name).replace(/[^A-Za-z0-9_]+/g, '_'); // "claude.ai Gmail" → mcp__claude_ai_Gmail__*
const display = name => String(name).replace(/^claude\.ai\s+/, '').replace(/\s+MCP$/, '');
function logoKey(name) {
  const n = norm(name);
  for (const [key, list] of Object.entries(ALIASES)) if (list.includes(n)) return key;
  return null;
}
const STATUS = { '✔': 'connected', '✓': 'connected', '!': 'needs-auth', '✗': 'failed', '✘': 'failed', '⏸': 'pending' };

let servers = [];        // the last discovery, enriched by fromInit()
let discoveredAt = 0;
let cfgMcp = { allow: [], deny: [], departments: {} };
let cfgWeb = true;

export function configure(cfg) {
  cfgMcp = { allow: [], deny: [], departments: {}, ...(cfg.mcp || {}), __cfg: cfg };
  cfgWeb = cfg.tools?.web !== false;
}
const matches = (s, x) => { const n = norm(x); return n && (norm(s.name) === n || s.id === x || s.key === n || toolId(x) === s.id); };
const denied = s => cfgMcp.deny.some(x => matches(s, x));
const allowed = s => !denied(s) && (!cfgMcp.allow.length || cfgMcp.allow.some(x => matches(s, x)));

function deptsFor(name, key) {
  for (const [k, v] of Object.entries(cfgMcp.departments || {})) if (norm(k) === norm(name) || (key && norm(k) === key)) return v.filter(d => DEPT_KEYS.includes(d));
  return DEPTS_BY_KEY[key || norm(name)] || DEPT_KEYS; // unknown → every pod (drawn as a shared connector)
}
function make(name, target, status) {
  const key = logoKey(name);
  return { id: toolId(name), rawName: name, name: display(name), key, status, target: target || '', source: /^claude\.ai\s/i.test(name) ? 'claude.ai' : 'local',
    depts: deptsFor(name, key), tools: [] };
}
export function parseList(text) {
  const out = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '').trim();
    const m = line.match(/^(.+?):\s+(.+?)\s+-\s+(\S)\s*(.*)$/); // "name: target - ✔ Connected"
    if (!m) continue;
    out.push(make(m[1], m[2], STATUS[m[3]] || (/connected/i.test(m[4]) ? 'connected' : /auth/i.test(m[4]) ? 'needs-auth' : 'failed')));
  }
  return out;
}
// `claude mcp list` health-checks every server before it prints a line: with 21 servers it took
// ~70 s on 17 Sep 2026, past the old 45 s limit, and every restart came up with no connectors —
// agents silently lost Gmail. So the wait is longer, the last good list is cached on disk, and an
// empty or timed-out discovery never replaces a list we already have.
let cacheFile = null;
export function useCache(file) {
  cacheFile = file;
  try { const c = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(c.servers) && c.servers.length && !servers.length) { servers = c.servers.map(s => make(s.rawName || s.name, s.target, s.status)); discoveredAt = c.at || 0; return servers.length; } } catch {}
  return 0;
}
export function discover({ timeout = 150000 } = {}) {
  return new Promise(resolve => {
    const env = { ...process.env }; delete env.CLAUDECODE;
    let out = '', done = false;
    const finish = list => {
      if (done) return; done = true;
      if (list && list.length) {
        servers = list; discoveredAt = Date.now();
        if (cacheFile) { try { fs.writeFileSync(cacheFile, JSON.stringify({ at: discoveredAt, servers: list.map(s => ({ rawName: s.rawName, name: s.name, target: s.target, status: s.status })) })); } catch {} }
      }
      resolve(servers);
    };
    let p;
    try { p = spawnClaude(claudeBin(cfgMcp.__cfg || {}), ['mcp', 'list'], { env, stdio: ['ignore', 'pipe', 'pipe'] }); } catch { return finish([]); }
    const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} finish(parseList(out)); }, timeout);
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    p.on('error', () => { clearTimeout(timer); finish([]); });
    p.on('close', () => { clearTimeout(timer); finish(parseList(out)); });
  });
}
// a run's `system init` event lists the servers the agent actually got, with live status + tool names
export function fromInit(init) {
  if (!init || !Array.isArray(init.mcp_servers)) return;
  const tools = Array.isArray(init.tools) ? init.tools : [];
  for (const m of init.mcp_servers) {
    let s = servers.find(x => x.id === toolId(m.name));
    if (!s) { s = make(m.name, '', 'connected'); servers.push(s); }
    if (m.status === 'connected' || m.status === 'needs-auth' || m.status === 'failed') s.status = m.status;
    else if (m.status === 'pending' && s.status !== 'connected') s.status = 'pending';
    const mine = tools.filter(t => t.startsWith(`mcp__${s.id}__`)).map(t => t.slice(s.id.length + 7));
    if (mine.length) { s.tools = mine; s.status = 'connected'; }
  }
  discoveredAt = discoveredAt || Date.now();
}
export function list() { return servers; }
export function usable() { return servers.filter(s => s.status === 'connected' && allowed(s)); }
export function allowedTools() {
  const t = usable().map(s => `mcp__${s.id}`);
  if (cfgWeb) t.push('WebSearch', 'WebFetch');
  return t;
}
export const keyOf = toolName => { const m = /^mcp__(.+?)__/.exec(toolName); if (!m) return null; const s = servers.find(x => x.id === m[1]); return s ? (s.key || s.id) : m[1]; };
export const namesOf = toolNames => [...new Set(toolNames.map(n => { const m = /^mcp__(.+?)__/.exec(n); if (m) { const s = servers.find(x => x.id === m[1]); return s ? s.name : m[1]; } return n === 'WebSearch' ? 'web search' : n === 'WebFetch' ? 'web fetch' : null; }).filter(Boolean))];
export function summary() {
  return { discoveredAt, web: cfgWeb, servers: servers.map(s => ({ ...s, allowed: allowed(s), denied: denied(s) })) };
}
// the line an agent reads about its tools
export function promptText(agentTools = []) {
  const u = usable();
  if (!u.length) return cfgWeb ? 'TOOLS\nYou have web search and web fetch. No business connectors are connected yet.' : 'TOOLS\nNone. Work from the notes.';
  const lines = u.map(s => `- ${s.name} (mcp__${s.id}__*)${s.tools.length ? ': ' + s.tools.slice(0, 12).join(', ') + (s.tools.length > 12 ? '…' : '') : ''}`);
  const mine = u.filter(s => agentTools.some(k => k === s.key || norm(k) === norm(s.name)));
  return 'TOOLS\nYou can call these connectors:\n' + lines.join('\n') + (cfgWeb ? '\n- Web search and web fetch' : '') +
    (mine.length ? `\nYour usual tools: ${mine.map(s => s.name).join(', ')}.` : '') +
    '\nRules: read freely (search, list, fetch) when it makes the work better. Anything that sends, posts, pays, deletes or changes data outside this machine — do it ONLY when the owner\'s request explicitly asks for that exact action; otherwise prepare it and say what you would send. Never ask the owner a question mid-task; make a reasonable assumption and mark it (assumed).';
}
