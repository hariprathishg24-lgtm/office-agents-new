// A stand-in for the Claude Code CLI, for the reliability tests. It speaks the same stream-json the
// office reads, never touches the network, and appends one line per call to $FAKE_LOG so a test can
// count exactly how many runs — and how many sends — happened.
//
// Behaviour is chosen by a marker in the owner's request text:
//   [fake:slow]      sleeps past any test deadline          [fake:error]    result with is_error
//   [fake:exit]      partial output, then exit 3            [fake:empty]    exit 0 with no result
//   [fake:sendfail]  (approve) calls a tool, then dies      [fake:prefail]  (approve) dies before any tool
//   [fake:wait=N]    takes N ms
// A request containing "send" or "email" is routed as needs_ok: true.
import fs from 'node:fs';

const args = process.argv.slice(2);
const log = entry => { if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ at: Date.now(), ...entry }) + '\n'); };
const emit = obj => process.stdout.write(JSON.stringify(obj) + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (args[0] === 'mcp') { console.log('No MCP servers configured.'); process.exit(0); }

const sysAt = args.indexOf('--system-prompt-file');
const system = sysAt >= 0 ? fs.readFileSync(args[sysAt + 1], 'utf8') : '';
let input = '';
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', async () => {
  let user = '';
  try { user = JSON.parse(input.split('\n')[0]).message.content.filter(b => b.type === 'text').map(b => b.text).join('\n'); } catch {}
  const mode = /You are the router/.test(system) ? 'router' : /VERDICT: PASS/.test(system) ? 'review' : /The owner has APPROVED/.test(user) ? 'approve' : /asked for changes/.test(user) ? 'rework' : /judged read-only/.test(user) ? 'readonly' : /send, post, pay or change NOTHING/.test(user) ? 'draft' : 'other';
  const marker = (user.match(/\[fake:([a-z]+)(?:=(\d+))?\]/) || []);
  const request = (user.match(/Owner's request: "?([^\n]*)/) || [])[1] || '';
  const approvedPart = mode === 'approve' ? user.slice(user.indexOf('Approved draft:')) : '';
  log({ mode, marker: marker[1] || '', request, systemChars: system.length, probe: process.env.FAKE_PROBE ? system.includes(process.env.FAKE_PROBE) : undefined, controlLinesInSend: mode === 'approve' ? /HANDOFF|NEEDS OWNER/.test(approvedPart) : undefined });
  if (mode === 'review') {
    emit({ type: 'result', subtype: 'success', is_error: false, result: /\[fake:reviewfail\]/.test(user) ? 'VERDICT: FAIL\n- "we doubled revenue for 40 clients" — invented proof, we have no clients' : 'VERDICT: PASS' });
    return process.exit(0);
  }
  emit({ type: 'system', subtype: 'init', mcp_servers: [], tools: [] });

  if (mode === 'router') {
    const needs = /send|email/i.test(request);
    emit({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify({ agent: 'lexi', title: request.slice(0, 60) || 'Task', plan: ['one'], eta_minutes: 5, why: 'fake', needs_ok: needs }) });
    return process.exit(0);
  }
  if (marker[1] === 'wait') await sleep(+marker[2] || 500);
  if (marker[1] === 'slow') { emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__apollo__search' }] } }); await sleep(60000); }
  if (marker[1] === 'error') { emit({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'API Error: overloaded' }); return process.exit(0); }
  if (marker[1] === 'exit') { emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'half a draft' }] } }); process.stderr.write('boom\n'); return process.exit(3); }
  if (marker[1] === 'empty') return process.exit(0);
  if (marker[1] === 'login') { emit({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Invalid API key · Please run /login' }); return process.exit(0); }
  if (marker[1] === 'offline') { process.stderr.write('API Error: getaddrinfo ENOTFOUND api.anthropic.com\n'); return process.exit(1); }
  if (/RESEARCH STEP: findings/.test(user)) { // findings come from the test's fixture file; ERROR = the feed/tool failed; NOBLOCK = an unreadable result
    const src = process.env.FAKE_FINDINGS || '';
    if (src === 'ERROR') { emit({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'web search tool unavailable' }); return process.exit(0); }
    if (src === 'NOBLOCK') { emit({ type: 'result', subtype: 'success', is_error: false, result: 'Here is a nice digest with no sources.' }); return process.exit(0); }
    emit({ type: 'result', subtype: 'success', is_error: false, result: `Research digest.\n\`\`\`findings\n${src ? fs.readFileSync(src, 'utf8') : '[]'}\n\`\`\`` }); return process.exit(0);
  }
  if (/PIPELINE STEP: research/.test(user)) { // the prospects come from the test's fixture file, never from the network
    const list = process.env.FAKE_PROSPECTS ? fs.readFileSync(process.env.FAKE_PROSPECTS, 'utf8') : '[]';
    emit({ type: 'result', subtype: 'success', is_error: false, result: `Researched against the ICP.\n\`\`\`prospects\n${list}\n\`\`\`` }); return process.exit(0);
  }
  if (/PIPELINE STEP: qualify/.test(user)) {
    const keys = [...user.matchAll(/^KEY: (\S+)/gm)].map(m => m[1]);
    const out = keys.map(key => /unclear/.test(key) ? { key, fit: 'unclear', reasons: [], disqualifiers: [], missing: ['headcount not found'] } : { key, fit: 'yes', reasons: ['12-person consultancy growing on referrals (cited)'], disqualifiers: [], missing: [] });
    emit({ type: 'result', subtype: 'success', is_error: false, result: `Qualified.\n\`\`\`qualification\n${JSON.stringify(out)}\n\`\`\`` }); return process.exit(0);
  }
  if (marker[1] === 'nothing' && mode === 'draft') { emit({ type: 'result', subtype: 'success', is_error: false, result: '**NOTHING TO SEND**\nChecked the inbox: no enquiries.' }); return process.exit(0); }
  if (mode === 'approve') {
    if (marker[1] === 'prefail') { process.stderr.write('auth expired\n'); return process.exit(1); }
    emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 's1', name: 'mcp__claude_ai_Gmail__send_message' }] } });
    log({ mode: 'SEND', request });
    if (marker[1] === 'sendfail') { await sleep(50); return process.exit(1); }
    emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 's1', is_error: false }] } });
    emit({ type: 'result', subtype: 'success', is_error: false, result: `Sent as approved.\nREF: fake-msg-${Date.now()}` }); return process.exit(0);
  }
  let extra = '';
  if (mode !== 'approve') {
    for (const h of user.matchAll(/\[fake:handoff:([a-z0-9]+)\]/g)) extra += `\nHANDOFF → ${h[1]}: enrich the prospect found in "${request.replace(/\[fake:[^\]]*\]/g, '').trim()}"`;
    if (/\[fake:ask\]/.test(user)) extra += '\nNEEDS OWNER: what is the monthly outreach budget?';
  }
  emit({ type: 'result', subtype: 'success', is_error: false, result: `FAKE ${mode} for: ${request}${extra}`, usage: { input_tokens: 1, output_tokens: 1 } });
  process.exit(0);
});
