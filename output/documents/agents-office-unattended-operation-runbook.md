# Agents Office Unattended Operation Runbook

*A controlled path from the current verified build to dependable daily operation*

Origin Pixel Solutions | Version 1.0 | 18 September 2026

## Current conclusion

The software is ready for a supervised pilot. It is not ready for unattended production until the owner completes the operating decisions, reviews the active roles, observes a limited real pilot, and verifies restart and monitoring on this Windows machine.

| Gate | Current result | Meaning |
|---|---|---|
| A - Deterministic reliability | Complete | 97 of 97 automated tests across 26 suites. |
| B - Integrated local workflow | Complete | 38 of 38 checks and 7 of 7 browser drills. |
| C - Limited real operation | Not started | Requires owner-approved limits, connectors, role reviews and an observed pilot. |

Safe unattended operation allows agents to perform approved read-only and local work on schedule. Sending, publishing, paying, signing, deleting, or changing an external system continues to require approval for the exact recipient and payload.

### How to use this runbook

- Complete Stages 1 through 6 in order. Do not install autostart before the pilot passes.
- Record every owner decision below. Do not substitute assumptions for missing limits.
- Stop at a failed gate, preserve evidence, fix the cause, and repeat the gate.
- Keep acquisition and research inactive until their limits are recorded and their connectors are ready.

## 1 Current verified state

| Area | Verified state | Remaining requirement |
|---|---|---|
| Code and tests | Clean `reliability-handoff` branch; Gates A and B pass. | Preserve the baseline and tag the pilot candidate. |
| Roles | 119 seats: 53 generic, 52 briefed, 14 contracted, 0 tested. | Owner reviews the 14 contracted seats before unattended use. |
| Task store | 29 tasks: 18 done, 7 cancelled, 3 waiting, 1 interrupted. | Resolve stale tasks, inspect the Instagram draft and reconcile the CEO run. |
| Routines | Five enabled and two paused. | Confirm every enabled routine has a tested role owner and acceptable schedule. |
| Acquisition | Inactive; four limits unset. | Set limits and connect prospect research before activation. |
| Research | Inactive; two limits unset. | Set cadence and findings limit before activation. |
| Service | Office down; autostart not registered. | Complete pilot, then verify scheduled startup and recovery. |
| Connectors | Apollo needs authorization; Zoho has an OAuth scope mismatch. | Authorize only required connectors and verify least privilege. |

### Definition of unattended operation

Unattended means the local service can start, stay healthy, run bounded read-only or local routines, produce drafts, pause on limits, and recover safely without someone keeping the page open. It does not mean autonomous authority over external actions.

| May run without approval | Must wait for owner approval |
|---|---|
| Read current notes; research public sources; create local prospect records; produce drafts; run deterministic checks; prepare reports. | Send messages; publish content; purchase tools or ads; sign terms; delete or modify external records; approve another role's work. |

## 2 Stage 1 Record operating decisions

Recommended pilot values are intentionally conservative.

| Decision | Recommended value | Owner value | Reason |
|---|---:|---|---|
| Outreach drafts per day | 5 | __________ | Small enough for daily factual review. |
| Follow-up delay | 4 days | __________ | Avoids immediate repeated contact. |
| Maximum follow-ups | 2 | __________ | Creates a hard stop. |
| Spend ceiling | INR 0 | __________ | No paid tools or ads during the pilot. |
| Research runs | 1 per week | __________ | Limits token and source-review load. |
| Findings per run | 5 | __________ | Keeps the digest reviewable. |
| Pilot duration *(manual)* | 7 calendar days | __________ | No config field: the owner enforces this by ending the pilot. |
| Pilot prospect cap *(manual)* | 25 total | __________ | No config field: only the four acquisition limits are enforced in code. |

Optional deadline: ____________________. Leave it unset rather than inventing one.

### Configuration procedure

1. Write the four acquisition values to `brain/Agents Office/acquisition.json`. Keep `active` false until Stage 5.
2. Write `runsPerWeek` and `findingsPerRun` to `brain/Agents Office/research.json`. Keep `active` false until Stage 5.
3. Commit the brain repository with a message naming the approved limits.
4. Run `npm run coverage` and the isolated checks.

- [ ] All six required values are explicit and non-null.
- [ ] The spend ceiling uses the owner's intended currency.
- [ ] Recording limits did not activate a connector or schedule.
- [ ] The owner approved the decision record.

## 3 Stage 2 Prepare connectors and local security

| Connector or boundary | Required action | Acceptance evidence |
|---|---|---|
| Apollo.io | Authorize the existing Claude connector with minimum scopes for prospect research. | A read-only test returns one known company and source; nothing is sent. |
| Zoho | Fix `OAUTH_SCOPE_MISMATCH` only if Zoho is required; otherwise leave disabled. | A read-only identity or list operation succeeds. |
| Notion | Keep denied unless the owner separately changes policy. | Configuration still shows Notion denied. |
| Server binding | Keep `127.0.0.1` loopback binding. | Health reports local-only; foreign Host requests are refused. |
| Claude login | Confirm the intended user session and plan headroom. | One observed read-only task succeeds. |

Never place credentials in company notes, task text, screenshots, logs, contracts or fixture results. Use the connector's authorization flow.

## 4 Stage 3 Clear the queue safely

This is not housekeeping. A routine has at most one open run and `waiting` counts as open, so **`outbound-first-touch` and `inbound-qualify` have not fired since 17 September** and will not until their two drafts are closed — two of the five enabled routines are dead. Both are "nothing found" reports written about twenty minutes before the office began filing such drafts as finished reports, and neither carries a `TO:` recipient: cancelling costs no Claude run, approving spends one on an outbound step with nothing to send.

| Record | Required disposition | Evidence |
|---|---|---|
| `mu4ybp1lzrs0` | Cancel after confirming nothing was sent. | Cancelled state and owner action in history. |
| `mu4yiaq6vr5p` | Cancel after confirming nothing was sent. | Cancelled state and owner action in history. |
| `mu4ybsp45ila` | Read four Instagram drafts; approve, reject with feedback, or cancel. | Explicit final state and review note. |
| Interrupted CEO run | Restart under observation and confirm boot reconciliation creates no external action. | Attempt history shows interruption and safe resolution. |

- [ ] No task remains `doing` from a previous process.
- [ ] Every waiting item has a named owner decision.
- [ ] Unknown external outcomes are reconciled before retry.
- [ ] Cancellation preserves task history.

## 5 Stage 4 Review and activate role capability

A passing fixture run is evidence for review. It does not automatically make a role tested. The owner must read the saved answers and approve the current contract hash.

| Role group | Seats | Review focus |
|---|---|---|
| First-client path | `pros`, `enzo`, `ilm`, `lexi`, `folo`, `cmail`, `piper`, `qa`, `dlead`, `pco` | Sources, fit, truthful claims, prices, approval boundaries and handoffs. |
| Enabled routine roles | `iggy`, `ceo` | No fabricated proof; useful content; evidence-based counts; no executive approval authority. |
| Paused routine roles | `vertical`, `prodz` | `vertical`: ICP changes stay evidence-based proposals requiring owner review. `prodz`: offers are packaged, never priced — every figure comes from the offer ladder verbatim. |

Both paused routine roles were contracted on 18 September and pass 3/3, so neither can run on its job title if its routine is later unpaused. Adding a capability contract promotes a seat to `contracted`, which is the bar `readiness.requireForOutbound` uses to permit a send without an owner override: never add a contract without running that seat's three fixtures in the same pass, or send authority widens with no evidence behind it.

### Owner review method

1. Open the latest results for one seat and confirm all three cases passed: normal, missing input and misleading input.
2. Read the actual answer. Check facts, prices, sources, tone, boundaries and final state.
3. Compare the behavior with the current capability contract.
4. Approve through the coverage interface only when the evidence is acceptable. Editing a contract invalidates an older review.
5. Record corrections as feedback, rerun the seat and review the new evidence.

- [ ] All 14 contracted seats show `tested`.
- [ ] No agent recorded a review on the owner's behalf.
- [ ] Rejected seats are excluded from enabled routines until they pass.

## 6 Stage 5 Run Gate C as a supervised pilot

Keep autostart off. Start manually, keep the owner available, and inspect outcomes daily.

| Pilot day | Action | Pass condition |
|---|---|---|
| Day 0 | Back up task state, routines and brain; record commit IDs; start manually. | Health ready, one lock owner, no unexpected catch-up action. |
| Day 1 | Run one read-only prospect task through Apollo. | Real dated sources; zero results produces an honest no-op. |
| Day 2 | Allow up to five prospect records and drafts. | No duplicates, invented facts or sends; drafts wait for approval. |
| Day 3 | Approve one reviewed message to a test or deliberately selected real recipient. | Exactly one send; correct recipient and payload; remote reference recorded. |
| Day 4 | Exercise follow-up timing without sending an unreviewed message. | Cadence and maximum follow-ups respected. |
| Day 5 | Pause/resume and simulate network loss on read-only work. | Nothing starts while paused; failure is clear; retry bounded. |
| Day 6 | Restart during read-only work. | Task recovered once; lock and history correct. |
| Day 7 | Review metrics and decide pass, extend or roll back. | Every mandatory threshold met. |

### Pilot metrics and thresholds

| Metric | Required threshold |
|---|---|
| Duplicate external actions | 0 |
| Unapproved external actions | 0 |
| Invented client, result, price or prospect facts | 0 |
| Unknown outcomes left unreconciled | 0 |
| Task recovery duplication | 0 |
| Daily owner intervention | Recorded and acceptable |
| Connector and Claude cost | Within approved ceiling |
| Critical test or health failure | 0 unresolved |

## 7 Stage 6 Enable unattended Windows operation

Install autostart only after Gate C passes and the owner accepts the pilot report.

### Preinstallation checks

- [ ] The office stopped cleanly and no Node process owns port 4520.
- [ ] `data/office.lock` is absent after clean shutdown.
- [ ] Enabled routines have tested role owners or are paused.
- [ ] Acquisition and research active flags match the owner's decision.
- [ ] Claude and connector accounts belong to the intended Windows user.
- [ ] Source and brain commit IDs are recorded for rollback.

### Install and verify

Run from the nested repository in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Check
```

1. Sign out and back in during a controlled window. Confirm exactly one process starts.
2. Open `http://localhost:4520/api/health` and `/ops`.
3. Terminate the process once to verify bounded restart backoff and exclusive locking.
4. Use Stop to verify an intentional stop is not restarted.
5. Confirm logs remain readable after restart.

### Rollback

Pause first, preserve task and attempt state, reconcile possible external actions, then remove autostart:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Uninstall
```

Restoring old code or state does not prove that an external message was never sent.

## 8 Daily and weekly operating procedure

| Frequency | Owner check | Action on failure |
|---|---|---|
| Daily | Heartbeat, failures, approvals, unknown outcomes, usage and next routines. | Pause if authority, duplication or state is uncertain. |
| Daily | Exact recipient and payload for every outbound draft. | Reject with feedback; never bypass approval. |
| Weekly | Prospects, replies, source quality, cost, corrections and first-client movement. | Tighten limits or pause low-quality channels. |
| Weekly | Research findings and proposed playbook changes. | Reject unsupported, stale or policy-changing claims. |
| Monthly | Contract hashes, reviews, connector scopes, logs, backups and recovery drill. | Invalidate stale reviews and revoke unnecessary access. |

### Safe response playbooks

| Condition | Required response |
|---|---|
| Claude login expired | Pause dispatch, log in, run one read-only check, then resume. |
| Usage or rate limit | Stop bounded retries; never retry outbound work automatically. |
| Network unavailable | Keep drafts local; retry only read-only work with backoff. |
| Outcome unknown | Do not resend. Check the remote system and reconcile. |
| Corrupt task store | Stop, preserve corruption and recover from validated backup. |
| Lock or recovery marker | Inspect the process; do not remove solely because health is unavailable. |
| Wrong or fabricated output | Reject, record correction, update skill/contract, rerun fixtures and review. |

## 9 Final production acceptance checklist

- [ ] Gate A passes on the production candidate.
- [ ] Gate B passes on the same candidate.
- [ ] Every routine-owning role that will run is tested against its current contract.
- [ ] Apollo or another approved source is verified read-only.
- [ ] Acquisition and research limits are explicit and enforced.
- [ ] No unexplained `doing` state or unknown external outcome exists.
- [ ] Gate C completed with zero duplicate, unapproved or fabricated external actions.
- [ ] Pause, stop, recovery, network loss and expired-login behavior were observed.
- [ ] Autostart uses the intended checkout and Windows user and starts one instance.
- [ ] Health, heartbeat, logs, usage guard and routine status are visible in `/ops`.
- [ ] Rollback commits and state backups are recorded and recoverable.
- [ ] The owner accepts that laptop sleep, shutdown, network and provider availability interrupt work.

### Production decision

| Decision | Selection |
|---|---|
| Gate C result | [ ] Pass  [ ] Extend pilot  [ ] Roll back |
| Acquisition | [ ] Active  [ ] Inactive |
| Research | [ ] Active  [ ] Inactive |
| Autostart | [ ] Install  [ ] Do not install |
| Outbound authority | Exact-action owner approval remains required |

Owner name: ____________________________________

Date: ____________________  Signature or recorded approval: ____________________________________

## 10 Command reference

Run commands from `C:\Users\harip\Downloads\Gittest\agents-office-main\agents-office-main`.

```powershell
# Automated tests
node --test --test-concurrency=1 test/*.test.mjs

# Integrated checks
$env:AO_BUILD_LOCAL_FILES="1"
$env:CHECK_LIVE="0"
node check.mjs

# Browser drill and coverage
node test/browser-drill.mjs
npm run coverage

# Start manually
start-office.cmd

# Check or remove autostart
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Check
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Uninstall
```

Keep real-operation commands separate from isolated checks. Do not set `CHECK_LIVE` unless a deliberate live test is authorized.
