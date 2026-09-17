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

---

# Later pass — 17 September 2026, 15:00–16:30 (Claude)

Picked up the tree above (the ChatGPT pass) without reverting anything, reviewed it, and committed it together with the remaining handoff items on `reliability-handoff`.

## Code changes

- An approval records the draft's `TO:` recipient, and the send is held to that recipient. Agents receive only the connectors wired to their department. Read-only server work retries network and usage failures with backoff (1 min, then 4 min, at most 3 attempts in total). Sends and login failures never retry.
- Correction memory: a correction is a *proposed* rule until the owner repeats it or confirms it (`POST /api/lessons/<id>/confirm`, owner only). A correction with the opposite sense is held as a conflict. Rules older than 180 days are flagged. Pending decisions list both.
- `/ops` shows price conflicts (a current note quoting an offer price that is not on the offer ladder) and seat readiness. Task sources record a note's effective date.
- A configured `claudePath`/`AO_CLAUDE` that does not exist is a clear spawn failure, never a silent fallback to another `claude`. A restart shorter than the heartbeat save interval is no longer reported as downtime.
- Fixture runner: a fresh brain copy and office per case (one shared office let a case read an earlier case's filed note). `expect` may list alternatives (`waiting|done`). `advisory` checks are reported without failing a case.
- Verification: `npm test` **80/80**, `node check.mjs` **38/38** (with `AO_BUILD_LOCAL_FILES=1`), browser drill passed. The live office was redeployed (pid 4768) with nothing running at the time. Connectors come from `data/mcp-cache.json`.

## Live fixture runs (real Claude, plan usage 19% → 77%)

- The 11:02 run hit the session limit on every case; its results are kept as `aborted-results-*` and are not evidence.
- Run 1 (fixtures v1) passed SALES LEAD, DELIVERY LEAD and PROJECT CO-ORDINATOR. Most other failures came from the fixtures: the tasks called the firm "made-up, not a real company", so agents correctly refused.
- Fixtures v2 frame each case as a practice run from given details. Run 2 passed PROPOSALS, PROSPECTOR, INBOUND LEADS MANAGER, CLIENT EMAILS, FOLLOW UPS and LEAD ENRICHER on every required check. **9 of 10 first-client seats pass.** Answers are saved in `brain/Agents Office/fixtures/<id>/results-*.json`.
- **QA failed 2 of 3, both real:**
  - Asked as a seat (not as the automatic reviewer), it answered "VERDICT: Hold" instead of PASS or FAIL. The format lives only in the reviewer prompt and the draft contract.
  - With no draft given, it reviewed an old hypothetical "Northwind Labs" proposal from the brain.
- Seven such practice and test deliverables are now marked SUPERSEDED (brain commit `60e0b58`), so retrieval no longer offers them. QA has not been re-run since.
- Seen in run 1: asked for a $4,000 "friend" price, PROPOSALS put it in the draft with a policy flag, and the QA reviewer failed it. In run 2 it priced from the ladder instead.
- INSTAGRAM ORGANIC and CEO fixtures (ChatGPT's) have not been run.

## Still owner-only

1. Review each seat's saved answers; only `POST /api/coverage/<id>/review {"passed", "notes", "approvedBy": "owner"}` makes a seat *tested* (0 today).
2. Acquisition limits and `"active"` in `brain/Agents Office/acquisition.json`; research budget in `research.json`.
3. Whether QA's seat brief should carry the PASS/FAIL format (it is in the draft contract, not yet in QA's brief).
4. Autostart (`scripts/install-autostart.ps1`), Gate C pilot, the 3 drafts waiting for approval.

## Next for any agent

Re-run `node fixtures.mjs qa`, then `iggy` and `ceo`, when plan usage is low: each seat costs about 3% of a session. Stop above ~60% on a day with routines due. Never write `review.json` yourself.

# Later pass — 17 September 2026, evening (Claude)

Built the six gaps the audit against the handoff PDF left open. `reliability-handoff` commits `6f5e4aa` and `5064334`.

## Code changes

- **Deadlines and budgets on a task.** `deadline` and `budget: { usd }` on `POST /api/tasks`, moved later with `POST /api/tasks/<id>/plan`. Every run records `costUSD` from Claude's own total. A task at its budget will not run, revise or rework until the owner raises it; `overdue` and `budget-spent` are pending decisions.
- **Per-seat measures.** `GET /api/coverage` and `npm run coverage` now carry `measures` for every seat: finished, failed, nothing-to-send, cancelled, waiting, completion rate, corrections the owner sent back, drafts the reviewer failed, unknown outcomes, cost and cost per finished task. Fixture runs record their cost too.
- **Unproven seats are limited.** `readiness.requireForOutbound` (default `contracted`, `AO_REQUIRE_FOR_OUTBOUND` overrides, `none` turns it off). An approval on a seat below the bar is refused and nothing is sent; the owner overrides with a reason, which is recorded on the approval with the seat's level. On the page: reply `send anyway: <why>`. All three drafts waiting today are from contracted seats, so none of them are blocked by this.
- **Research watches pages and measures its own rules.** `watch` + `watchEveryHours` in `research.json`; a changed page starts one focused run inside the weekly budget, and a change it cannot cover or a page it cannot read becomes an owner decision. `GET /api/research` → `effects` compares each published rule's seats' fixture pass rates before and after; a regression asks for a rollback, an unmeasured rule asks for a fixture run.
- **Commercial terms.** `partnerRates`, `partnerMargin`, `paymentTerms` in `acquisition.json` (optional, unset by default). Proposals state them verbatim or name them as not established.
- **Launcher.** `timeout /t` does not wait when there is no console (a Scheduled Task, redirected input), so the restart backoff was doing nothing; it sleeps through PowerShell now. `PORT` and `AO_LOG_DIR` are settable, which is what lets the new test drive it.

## Verification

- `npm test` **95/95** (15 new: broken stdin, API timeout, port in use, usage hold, launcher restart and stop, budgets, overdue, measures, seat limits, terms, watched pages, rule effects).
- `node check.mjs` **38/38**, browser drill **7/7** (with `AO_BUILD_LOCAL_FILES=1 CHECK_LIVE=0`).
- The usage hold test pins the gauge with `AO_USAGE_PERCENT` — a test-only override; never set it on the office.
- The browser drill now closes the desktop 3D page before loading the phone one: two software-rendered offices at once starved each other on this machine.

## Live office

Redeployed with nothing running: old launcher stopped first (cmd reads a batch file by byte offset, so rewriting it under a running launcher is unsafe), office stopped through `POST /api/office/stop`, new launcher started. Now pid 46112, launcher pid 38208, 27 tasks intact, 3 approvals waiting, plan session 11% / week 53%.

## Still owner-only

Unchanged from the pass above: seat reviews, acquisition limits and research budget, QA's PASS/FAIL format, autostart, and the 3 drafts. The new slots (`partnerRates`, `partnerMargin`, `paymentTerms`, task budgets and deadlines) are the owner's numbers — they are written as unset and stay that way until the owner gives them.
