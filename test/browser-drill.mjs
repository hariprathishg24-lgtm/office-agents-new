// Gate B drill, fake Claude: the served page, a task that sends, the approval card, one send.
//   node test/browser-drill.mjs        (needs playwright-core and Chrome; not part of npm test)
import { chromium } from 'playwright-core';
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
  await step('no page errors', async () => { if (errs.length) throw new Error(errs[0]); });
} catch { failed = true; }
finally { if (browser) await browser.close(); await office.stop(); s.cleanup(); }
process.exit(failed ? 1 : 0);
