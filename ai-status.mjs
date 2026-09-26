import { claudeBin, spawnClaude } from './claude-bin.mjs';

// Authentication metadata only: no prompt, model usage, or account details returned.
export function createAIStatus(cfg) {
  let cached, pending;
  return async function status(backend) {
    if (backend !== 'claude-cli') return { connection: 'unavailable', detail: 'Claude Code CLI is not selected.' };
    if (cached && Date.now() - cached.time < 30000) return cached.value;
    if (pending) return pending;
    pending = new Promise(resolve => {
      const bin = claudeBin(cfg);
      let finished = false, timer, output = '';
      const finish = value => {
        if (finished) return;
        finished = true; clearTimeout(timer);
        cached = { time: Date.now(), value: { ...value, checkedAt: new Date().toISOString() } };
        resolve(cached.value);
      };
      if (!bin) return finish({ connection: 'disconnected', detail: 'Claude Code CLI is not installed.' });
      let child;
      try { child = spawnClaude(bin, ['auth', 'status', '--json'], { stdio: ['ignore', 'pipe', 'ignore'] }); }
      catch { return finish({ connection: 'unavailable', detail: 'Unable to check CLI authentication.' }); }
      timer = setTimeout(() => { child.kill(); finish({ connection: 'unavailable', detail: 'Authentication check timed out.' }); }, 8000);
      child.stdout.on('data', chunk => { if (output.length < 65536) output += chunk; });
      child.on('error', () => finish({ connection: 'unavailable', detail: 'Unable to start CLI authentication check.' }));
      child.on('close', () => {
        try {
          const result = JSON.parse(output);
          if (typeof result.loggedIn !== 'boolean') throw Error();
          finish({ connection: result.loggedIn ? 'connected' : 'disconnected', detail: result.loggedIn ? 'CLI is signed in. Provider availability is confirmed when a task runs.' : 'Sign in to Claude Code CLI to enable AI.' });
        } catch { finish({ connection: 'unavailable', detail: 'This CLI did not return a valid authentication status.' }); }
      });
    });
    try { return await pending; } finally { pending = null; }
  };
}
