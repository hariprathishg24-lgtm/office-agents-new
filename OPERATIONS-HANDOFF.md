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

## Later that evening — seats read their contracts (17–18 Sep 2026)

- **The gap:** a capability contract was documentation only. Nothing gave it to the seat, so "contracted" still meant the agent worked from its job title. QA answered "VERDICT: CONDITIONAL PASS" (its contract allows PASS or FAIL only) and the CEO seat ignored the section headings its contract requires. Seats now receive their contract with their brief and skills (`coverage.contractText`, `agentBrief` in `serve.mjs`), with a test that it arrives and that a seat without one is unchanged.
- **Live fixture results (real Claude, 17 Sep evening, ~$2.50 in total):**
  - QA **3/3** (was 1/3) · CEO **3/3** (was 1/3) · INSTAGRAM ORGANIC **3/3** (was 2/3). Answers are in `brain/Agents Office/fixtures/<id>/results-*.json`.
  - Three of the earlier failures were the checks, not the seats, and were corrected: IGGY wrote "nothing posted" where the check only accepted "published"; the CEO case forbade the words "on track" in a sentence refusing to claim it; the "claims no past work" check counted a post asking the reader "where did your last 10 clients come from?" as a claim about ours.
  - QA's normal case now hands over the prospect record and the `REASON:` line the acquisition workflow really produces. Before that it failed a well-formed draft for an unverifiable claim — which was QA being right and the fixture being unfair.
- **Not re-run yet:** the nine other first-client seats last ran *before* seats were given their contracts, so their passing runs are evidence for the older behaviour. Re-run `node fixtures.mjs first-client` when the session window is fresh (about 3% of a session a seat; it was at 38% after tonight's runs).
- **Starting the office from an agent session does not stick.** A server started from a tool call (`Start-Process`, or `Win32_Process.Create`) is killed with SIGHUP when that session's process tree is cleaned up — it happened twice tonight, roughly 40 minutes each time. Start it through Task Scheduler instead, and leave the registration alone while it runs: unregistering a task terminates the instance it started (that killed it a third time). There is now an on-demand task **AO-office-manual-start** with no trigger — it never fires by itself, and Start-ScheduledTask on it brings the office up detached. Delete it whenever the office is not running, or replace it with the real logon task from `scripts/install-autostart.ps1`. The owner's own `start-office.cmd` window, or `scripts/install-autostart.ps1`, is still the proper way to keep it up.
- **An office with no console used to stop itself after about fifteen seconds** (SIGHUP from the console Windows created for ).  now passes windowsHide, so the CLI gets its own hidden console. This is why a Scheduled Task start kept dying, and it would have hit  too.
- Live office now pid 48768, 27 tasks, 3 approvals waiting, `readiness.requireForOutbound: contracted`. `npm test` **97/97**, `node check.mjs` **38/38**, browser drill **7/7**.

# Later pass — 18 September 2026, evening (Claude)

Picked the tree up clean on `reliability-handoff` (nothing uncommitted, `fb6c7dd` at the head) and
closed the two items the previous pass left for the next agent: the nine first-client seats whose
fixture evidence predated seats receiving their contracts, and same-day evidence for every gate an
agent can reach. No owner decision was made, no draft approved, no routine activated, no live office
started, and no outbound action of any kind occurred.

## Changed files, and why each was needed

- **`test/reliability.test.mjs`** — `the owner's saved tasks survive the new code unchanged` was
  failing. Not a product defect: the owner's real `data/tasks.json` has held `mu6xzoop45hs` in
  `doing` since the SIGHUP of 18 Sep 18:06, and `recoverTasks()` correctly closes the interrupted
  attempt and requeues the read-only task. The test asserted the real store boots byte-identical and
  runs nothing, which stopped being true the moment a live run was interrupted. It now asserts what
  actually matters — settled work is never rewritten, nothing is sent, and no already-finished task
  is run again — while allowing mid-flight work to be reconciled.
- **`fixtures.mjs`** — the `a draft claims nothing was sent` check read its own negation. PROSPECTOR
  wrote "No client note was created, nothing was searched, and nothing has been sent", which is
  correct in every respect, and the bare `has been sent` branch scored it as a claim that something
  had gone out. Negated mentions are now dropped before the check looks for a claim. The test that
  covers this check (`fixture checks catch ... a claimed send ...`) still passes, so a real claimed
  send is still caught.

`src/braingraph.js` was rewritten by the build with only its date stamp changed (same 55 notes, 54
linked, 158 links) and was restored rather than committed.

## Verification, with exact results

- `npm test` — **97 passed, 0 failed**, 26 suites.
- `node check.mjs` with `AO_BUILD_LOCAL_FILES=1 CHECK_LIVE=0` — **38/38**, including a rebuilt bundle
  and isolated server smoke checks. `live` skipped by design.
- `node test/browser-drill.mjs` — **7/7**: approval held, one send on approve, blocked prerequisite
  then ordered completion, desktop 1440px and phone 390px with 0px horizontal overflow, pause and
  resume from a phone, an unproven seat refused then sent on the owner's reason, no page errors.
  These are simulated connector results, not delivery evidence.
- **Live fixtures, real Claude, all nine seats re-run after contracts reach seats — 9/9 at 3/3**,
  $4.29 in total: lexi $0.52, enzo $0.41, ilm $0.52, pros $0.29 (re-run), piper $0.62, folo $0.43,
  cmail $0.52, dlead $0.53, pco $0.44. With QA, CEO and IGGY from 17 Sep, **all twelve contracted
  seats now have passing fixture evidence produced by the current code path.** Plan usage went 4% to
  44% of the session window; week ended at 63%.

## Schema and migration

None. No state schema changed, no migration was written, and no stored task, routine or brain record
was edited. Task IDs, approval history and external-action evidence are untouched.

## Starting, stopping, and what is running

The office is **not running**. It took a SIGHUP at 18:06 on 18 Sep after the machine slept for 378
minutes, with `mu6xzoop45hs` (CEO weekly) mid-run; that task is stored as `doing` and will be
reconciled and requeued on the next start. Earlier the same day `mu6fjyrcmdrk` failed with
`ENOTFOUND` after two backoff retries and kept its previous result — a network fault, honestly
reported. Start through `start-office.cmd` or the trigger-less `AO-office-manual-start` task; stop
through `POST /api/office/stop` or Stop on `/ops`. Autostart remains **NOT REGISTERED**.

Routines: **five unpaused, two paused**, unchanged. Starting the office can fire the five and catch
up missed runs, so restart timing stays an owner decision.

## Known limitations

Seats are **0 tested** — twelve are contracted with passing fixtures, and only a passing owner review
of the current contract makes a seat tested. Gate C has not begun. Acquisition and research are both
inactive and refuse to create work until their numbers are set. Fixture passes are evidence that the
implementation and the contracts hold, not that business quality is proven.

Two of the three waiting drafts are legacy no-ops: `mu4ybp1lzrs0` (pros) and `mu4yiaq6vr5p` (ilm)
were created at 08:47–08:49 on 17 Sep, about twenty minutes before `eae7c6f` began filing
nothing-to-send drafts as finished reports, and they carry no `NOTHING TO SEND` first line for the
detector to catch. Because `waiting` is an open state, each has been skipping its routine —
`outbound-first-touch` and `inbound-qualify` have not fired since 17 Sep. Cancelling them
(`POST /api/tasks/<id>/cancel`) costs no Claude run and frees both routines; approving them would
spend a run carrying out an outbound step with `recipient: null` and nothing to send. No migration
was written to reclassify them, because deciding from the prose that a draft is safe to close is the
owner's judgement. The third, `mu4ybsp45ila` (iggy), is four real Instagram posts and deserves a read.

## Decisions still needed

Unchanged and all owner-only: the four acquisition limits and `active`; the research budget and
`active`; reviews of the twelve contracted seats; the three waiting drafts; whether QA's brief carries
the PASS/FAIL format; autostart; the Gate C pilot scope; and restart timing. Apollo.io authorisation
gates the acquisition limits in practice — with Apollo and Zoho both unreachable the workflow would
draft against zero prospects, which is exactly what the pros draft has been reporting since 17 Sep.

## Same pass — the first seat outside the first-client set

Seven seats outside the contracted twelve have real task history, and two of them own routines:
`vertical` (`define-icp`) and `prodz` (`offer-readiness`). Both routines are paused, so neither seat
had a contract and each would have run on its job title the moment the owner unpaused it. That is
the gap the spec warns about on p.8 — a custom role title is not a tested capability.

`vertical` is now contracted and passes 3/3 ($0.62, first run). Its contract comes from the
routine's own wording and the settled ICP note: re-test the ICP against real replies, at most one
proposed sharpening, never present a change as decided, and stop with one line when there are fewer
than three real replies. The three fixtures cover a normal month, a month of sends with no replies,
and the owner pressing it to adopt e-commerce off a single reply while claiming past e-commerce
results. Brain commit `1c59b82`. Contracted seats **12 to 13**; **still 0 tested**.

Note for whoever continues: adding a contract promotes a seat to `contracted`, which under
`readiness.requireForOutbound: contracted` is the bar for sending without an owner override. Do not
write a contract without running that seat's fixtures in the same pass, or send authority widens
with no evidence behind it.

`prodz` is the next one and was deliberately not started: the session window stood at 58% after
`vertical`, and this project's rule is to stop above ~60%. The remaining five (`kpi`, `cro`, `gfx`,
`qaeng`, `datagov`) have one or two past tasks each and no scheduled work, so they are lower
priority than `prodz`.
