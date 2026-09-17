// Gate B drill, fake Claude: the served page, a task that sends, the approval card, one send.
//   node test/browser-drill.mjs        (needs playwright-core and Chrome; not part of npm test)
import { chromium } from 'playwright-core';
import path from 'node:path';
import { scratch, startOffice, sleep } from './helpers.mjs';

const s = scratch('browser');
const office = await startOffice({ brain: s.brain, data: s.data });
let browser, failed = false;
const step = async (name, fn) => { try { const d = await fn(); console.log(`✓ ${name}${d ? '  — ' + d : ''}`); } catch (e) { failed = true; console.log(`✗ ${name}  — ${e.message}`); throw e; } };
try {
  try { browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] }); }
  catch { browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] }); }
  const page = await browser.newPage({ viewport: { width: 1512, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(office.base + '/'); await page.waitForTimeout(3000);
  await step('page is live', async () => { const m = await page.evaluate(() => document.querySelector('.tp-mode').textContent); if (!/LIVE/.test(m)) throw new Error(m); return m; });
  let sid;
  await step('a task that sends waits for approval instead of landing as done', async () => {
    await page.click('.tp-dd'); await page.click('.tp-menu button[data-k="sales"]');
    await page.fill('.tp-in', 'send an email to the browser drill prospect'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.CC.tasks.tasks.some(t => t.live && t.state === 'waiting'), null, { timeout: 20000 });
    const t = await page.evaluate(() => { const t = window.CC.tasks.tasks.find(x => x.live && x.state === 'waiting'); return { sid: t.sid, agent: t.agent, draftAt: t.draftAt }; });
    sid = t.sid;
    const server = await office.task(sid);
    if (server.state !== 'waiting' || server.waitingAt !== t.draftAt) throw new Error('page and server disagree: ' + JSON.stringify({ server: server.state, t }));
    if (office.calls().some(c => c.mode === 'SEND')) throw new Error('something was sent before approval');
    return `${t.agent} · waiting · nothing sent`;
  });
  await step('approving from the page sends exactly once and lands done', async () => {
    const agent = await page.evaluate(id => window.CC.tasks.tasks.find(x => x.sid === id).agent, sid);
    await page.evaluate(a => { window.CC.tasks.resolveLive(a, true); window.CC.tasks.resolveLive(a, true); }, agent); // a double click
    await office.until(sid, t => t.state === 'done');
    await page.waitForFunction(id => window.CC.tasks.tasks.find(x => x.sid === id)?.state === 'done', sid, { timeout: 20000 });
    await sleep(1500);
    const n = office.calls().filter(c => c.mode === 'SEND').length;
    if (n !== 1) throw new Error(`${n} sends`);
    return '1 send';
  });
  await step('a blocked task shows as blocked and the page does not start it', async () => {
    const up = (await office.api('POST', '/api/tasks', { dept: 'ops', text: 'list the drill firms' })).body;
    await office.api('POST', '/api/office/pause', { why: 'drill' }); // keep the prerequisite unfinished while the page looks
    const down = (await office.api('POST', '/api/tasks', { dept: 'ops', text: 'list the drill owners', after: [up.id] })).body;
    await page.waitForFunction(id => window.CC.tasks.tasks.find(x => x.sid === id)?.state === 'blocked', down.id, { timeout: 20000 });
    await sleep(8000);
    const st = (await office.task(down.id)).state;
    if (st !== 'blocked') throw new Error('server state ' + st);
    const label = await page.evaluate(() => [...document.querySelectorAll('.tp-st.blocked')].length);
    await office.api('POST', '/api/office/resume');
    await page.waitForFunction(id => window.CC.tasks.tasks.find(x => x.sid === id)?.state === 'done', down.id, { timeout: 30000 }).catch(async e => { const pg = await page.evaluate(([u, d]) => window.CC.tasks.tasks.filter(x => x.sid === u || x.sid === d).map(x => ({ sid: x.sid, state: x.state, err: x.error, res: String(x.result || '').slice(0, 80), running: x.running, ready: x.ready })), [up.id, down.id]); throw new Error(JSON.stringify({ page: pg, server: [await office.task(up.id), await office.task(down.id)].map(t => ({ state: t.state, error: t.error, history: t.history })) })); });
    return `blocked on the page (${label} blocked chip${label === 1 ? '' : 's'}), then ran after its prerequisite`;
  });
  await step('the operations page works on a desktop and a phone, and pauses the office', async () => {
    const out = [];
    for (const [label, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
      const p = await browser.newPage({ viewport: vp }); p.on('pageerror', e => errs.push('ops: ' + e.message));
      await p.goto(office.base + '/ops'); await p.waitForFunction(() => /LIVE|PAUSED/.test(document.getElementById('status').textContent), null, { timeout: 15000 });
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) throw new Error(`${label}: page scrolls sideways by ${overflow}px`);
      const tooSmall = await p.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 24).length);
      if (tooSmall) throw new Error(`${label}: ${tooSmall} buttons under 24px tall`);
      await p.screenshot({ path: path.join(s.dir, `..`, `ops-${label}.png`), fullPage: true }).catch(() => {});
      if (label === 'phone') {
        p.once('dialog', d => d.accept('drill'));
        await p.click('#pause');
        await p.waitForFunction(() => /PAUSED/.test(document.getElementById('status').textContent), null, { timeout: 15000 });
        if (!(await office.api('GET', '/api/health')).body.paused) throw new Error('the button did not pause the office');
        await p.click('#pause');
        await p.waitForFunction(() => /LIVE/.test(document.getElementById('status').textContent), null, { timeout: 15000 });
      }
      out.push(`${label} ${vp.width}px ok`);
      await p.close();
    }
    await page.close(); // two software-rendered 3D offices at once starve each other; the desktop one is done
    const main = await browser.newPage({ viewport: { width: 390, height: 844 } }); main.on('pageerror', e => errs.push('office on a phone: ' + e.message));
    await main.goto(office.base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 }); await main.waitForTimeout(4000);
    const mainOverflow = await main.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await main.close();
    return out.join(' · ') + ` · pause and resume from a phone · the 3D office at 390px scrolls sideways by ${mainOverflow}px`;
  });
  await step('an unproven seat\'s send is refused on the page, then sent on the owner\'s "send anyway: <why>"', async () => {
    const s2 = scratch('browser-limited');
    const limited = await startOffice({ brain: s2.brain, data: s2.data, env: { AO_REQUIRE_FOR_OUTBOUND: 'contracted' } });
    const p = await browser.newPage({ viewport: { width: 1512, height: 900 } }); p.on('pageerror', e => errs.push('limited: ' + e.message));
    try {
      const t = (await limited.api('POST', '/api/tasks', { dept: 'sales', text: 'send an email to the limited drill prospect' })).body;
      await limited.api('POST', `/api/tasks/${t.id}/run`);
      await p.goto(limited.base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await p.waitForFunction(id => window.CC?.tasks?.tasks.find(x => x.sid === id)?.state === 'waiting', t.id, { timeout: 30000 });
      await p.evaluate(a => window.CC.tasks.resolveLive(a, true), t.agent);
      await sleep(1500);
      if ((await limited.task(t.id)).state !== 'waiting' || limited.calls().some(c => c.mode === 'SEND')) throw new Error('the limited send was not refused');
      await p.waitForFunction(id => window.CC.tasks.tasks.find(x => x.sid === id)?.state === 'waiting', t.id, { timeout: 20000 });
      const took = await p.evaluate(a => window.CC.tasks.overrideLive(a, 'send anyway: I read it myself'), t.agent);
      if (!took) throw new Error('the page did not offer the override');
      const done = await limited.until(t.id, x => x.state === 'done', 20000);
      if (done.approval?.override?.reason !== 'I read it myself') throw new Error('the reason was not recorded: ' + JSON.stringify(done.approval));
      const n = limited.calls().filter(c => c.mode === 'SEND').length; if (n !== 1) throw new Error(`${n} sends`);
      return `refused at "${done.approval.seatLevel}", then 1 send with the owner's reason recorded`;
    } finally { await p.close(); await limited.stop(); s2.cleanup(); }
  });
  await step('no page errors', async () => { if (errs.length) throw new Error(errs[0]); });
} catch { failed = true; }
finally { if (browser) await browser.close(); await office.stop(); s.cleanup(); }
process.exit(failed ? 1 : 0);
