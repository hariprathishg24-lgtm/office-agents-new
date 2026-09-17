# Implementation handoff — 17 September 2026

Existing Claude and Codex edits were preserved. This pass completes the single-instance lock review and offline-check isolation. The running office was not restarted, and no real Claude task, outbound action, spending, or schedule activation was performed.

## Changes completed in this pass

- Preserved the exclusive-create lock and serialized stale-lock recovery. Only `ESRCH` (no such process) now proves that a PID is dead; unexpected lookup errors preserve the lock.
- Moved lock acquisition ahead of startup work and connector discovery. A rejected second office exits before starting discovery. Exit cleanup is registered immediately after acquisition.
- Added independent-process contention tests for both a missing lock and a dead holder, plus invalid PID and interrupted-recovery tests. A live holder without an HTTP listener remains protected.
- Offline `npm run check` now copies the brain into temporary storage, uses separate temporary data, forces the fake Claude CLI, disables usage calls, removes inherited API credentials, and binds to loopback. It waits for the child to close before cleanup. Build outputs remain project-local.
- Test servers ask the OS for an available port instead of guessing in a range containing Windows reservations, and accept health responses only from their own child PID.
- Added opt-in `AO_BUILD_LOCAL_FILES=1` resolution in `build.mjs` and `scripts/local-build-files.mjs`. It bundles the current source using Node reads confined to this checkout (including local Three.js), avoiding esbuild's blocked ancestor-directory scan. Unknown dependencies and paths outside the checkout are refused; normal build behavior remains the default.

## Verification

- `npm test`: **78 passed, 0 failed**, 18 suites. Real local servers use scratch brains/data and fake Claude.
- `node check.mjs` with `CHECK_LIVE=0` and `AO_BUILD_LOCAL_FILES=1`: **38/38 passed**, including a fresh 1301 KB bundle, offline browser checks, and isolated server smoke checks. The final combined tree also passed all **78 tests**.
- Default build resolution encountered `Cannot read directory "../../../..": Access is denied`, followed by failure to resolve `./src/main.js`. An ancestor read-access request returned a grant but did not resolve that failure. The scoped build mode above succeeds without esbuild ancestor scanning.
- `node test/browser-drill.mjs`: **passed on the rebuilt UI**. Manual outbound work waited for approval; double approval made exactly one fake send; blocked prerequisites stayed blocked then completed in order; desktop 1440px and phone 390px operations views had no horizontal overflow; phone pause/resume worked; the 3D office at 390px had zero horizontal overflow; no page errors. Desktop and phone operations screenshots were visually inspected. These are simulated connector results, not real delivery evidence.
- Syntax checks passed for `ops.mjs`, `serve.mjs`, `check.mjs`, `test/helpers.mjs`, and `test/ops.test.mjs`; `git diff --check` passed.
- Read-only `scripts/install-autostart.ps1 -Check`: **NOT REGISTERED**.

## Observed readiness and owner decisions

- Coverage: 119 seats — 55 generic, 54 briefed, 10 contracted, **0 tested**. All ten first-client seats are contracted. Their live fixture checks and review of the current contracts are still outstanding. Fake tests validate the implementation, not real agent quality. Live fixtures use the Claude plan and were not run in this pass.
- Acquisition is inactive. Set `outreachPerDayMax`, `followUpDays`, `maxFollowUps`, and `spendCeiling` in `brain/Agents Office/acquisition.json` before deciding to activate it. `deadline` remains an optional owner decision. A zero spend ceiling is a valid decision.
- Research is inactive. Decide `runsPerWeek` and `findingsPerRun`, review topics/cadence, and explicitly decide activation in `brain/Agents Office/research.json`.
- Existing routines are separate from those two inactive workflows: **five unpaused, two paused**. Starting/restarting with the clock enabled can run existing scheduled work and catch up missed routines. Decide the desired schedule and restart timing before replacing the running server.
- Snapshot of stored tasks: 17 done, 7 cancelled, 3 waiting, no unknown send outcomes. The three waiting drafts still need owner review; this pass approved none.
- Autostart is not installed. Decide whether to enable it only after validating the desired routines, Claude login, and restart behavior. No Scheduled Task was created.
- Offer and ICP are already marked settled in the business notes. Remaining business choices include acquisition effort ceilings, spend, and deadline; do not reopen settled prices or invent missing targets.

## Lock recovery and rollout

A live process retains its lock even if its health endpoint is unreachable. Inspect that process before trying another start. A dead holder is reclaimed automatically. Malformed locks, unverifiable PIDs, and interrupted `.recovery` markers fail closed: inspect them and establish that no office or recovery process is active before manually removing a marker. Do not delete locks merely because HTTP health is unavailable.

The replacement task reported PID 27748 on port 4520, started before these changes, and left it alone. This task's earlier listener query returned no entry; therefore neither observation establishes current production status. Recheck process identity before a deliberate restart. No production listener was started or stopped by this task. Real-agent fixture review and observed production recovery remain rollout gaps; the local build and simulated UI workflow are now verified.

## Reproducing checks and deliberate operation

From the nested repository in PowerShell:

```powershell
$env:AO_BUILD_LOCAL_FILES = '1'
$env:CHECK_LIVE = '0'
node --test --test-concurrency=1 test/*.test.mjs
node check.mjs
node test/browser-drill.mjs
```

For deliberate real operation, `start-office.cmd` starts the office with crash backoff; it can dispatch the five unpaused routines. `/ops` provides pause/resume and Stop. Stop uses exit code 3 so the launcher does not restart it. Autostart installation remains a separate owner decision. No state schema migration was introduced in this pass. Keep existing task/brain records and approval history when rolling code back, and reconcile unknown external outcomes before any retry. An interrupted lock-recovery marker requires inspection rather than blind deletion.
