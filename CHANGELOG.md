# Changelog

## Unreleased — reliability (17 Sep 2026)

Phases 0–2 of the reliability handoff, plus the prompt-honesty part of Phase 3 and the local-access part of Phase 8. `npm test` (19 checks, fake Claude, throwaway state) proves each item below.

- **Approval survives routing.** A task typed into the bar keeps the router's `needsOk`. Anything that sends, posts, pays or changes something drafts first and waits in WAITING ON APPROVAL, like a routine. Read-only tasks are told they are read-only.
- **One run per request.** Run, revise, approve and reject claim the task on the server before anything starts. Two clicks, two tabs, or the page and the clock asking at once give one Claude run; the rest get 409 "already running". Every run is recorded in `attempts`.
- **An approval is for one draft.** The draft's hash is frozen when you approve. A rework needs a new approval, an approve naming an older draft is refused, and a draft edited on disk cannot be approved.
- **A failed send is never silently repeated.** If a send fails before the agent calls any tool, nothing went out and the draft goes back to waiting. If it fails after, the task is marked OUTCOME UNKNOWN (`needsCheck`) and cannot be approved or revised again until you check.
- **Errors are errors.** A result flagged `is_error`, a nonzero exit or a run with no result now fails, and any partial text is kept but not delivered. A timeout names what the agent was last doing ("calling Apollo"). A broken stdin no longer crashes the office.
- **The whole price list reaches the agent.** The system prompt goes to the CLI as a file (`--system-prompt-file`), so the Windows 32,767-character limit no longer cuts notes. Six of the eight core notes were being cut (the price list, ICP, services, rules) while the prompt called them "complete". Notes now go in whole, and any cut is labelled `[CUT]`.
- **Safe storage.** `data/tasks.json`, routine state and usage state are written atomically, with the previous copy kept as `.bak`. A damaged file is kept, reported, and never overwritten with an empty list.
- **Restart recovery.** On boot, routine tasks waiting to run go back in the queue. Interrupted read-only work is picked up again (at most 3 attempts in total). An interrupted send goes back to waiting if it had not started, or is marked OUTCOME UNKNOWN if it had.
- **Filing is not the work.** If the note cannot be saved, the task stays done with `filed: failed`.
- **This machine only.** The server listens on 127.0.0.1 (`AO_HOST` to change). Posts from other websites and foreign Host headers get 403.
- **Launcher.** `start-office.cmd` checks that an office actually answers on 4520 and restarts crashes with backoff (up to 5 quick restarts). The log is capped at 5 MB. Its comment no longer claims a Scheduled Task that was never registered.
- **Checks never touch real state.** `npm run check` runs its server with a scratch data folder and the clock off. The tests use `AO_DATA`, `AO_BRAIN`, `AO_CLAUDE` (a fake CLI), `AO_CLOCK=off`, `AO_USAGE=off`, `AO_TIMEOUT_MS`.
- **Knowledge that can be trusted (Phase 3).** Client records under `Agents Office/Clients/**` are indexed. Archive, sample, demo and template folders are skipped, and a client's record goes only to a task that names that client. A note with `status: superseded` / `archived` in its front matter, or the `> **SUPERSEDED` banner, stays in the brain as history but is never handed to an agent. Every task records `sources`: each note's path, last change, content hash and why it was picked (core or relevant). Agents are now told to name a missing fact instead of "making a reasonable assumption", matching the brain's own rules. `npm test` gains 6 knowledge checks.
- **Readiness you can see (Phase 4).** `npm run coverage` gives every one of the 119 seats a level: generic, briefed, contracted or tested. "Tested" needs a complete capability contract, the three fixture cases and a passing owner review of that exact contract; editing the contract voids the review. The report lists each seat's gaps and puts the ten first-client seats first. Today: 55 generic, 64 briefed, 0 contracted, 0 tested. The shipped house style no longer tells agents to write an unsourced number as "(assumed)". `npm test` gains 3 coverage checks.
- **Coordination across roles (Phase 7).** A task can wait on others (`after`). It stays **blocked**, and the page never starts it, until they finish. A failed, cancelled or unknown-outcome prerequisite keeps it blocked, with the reason written on it.
  - An agent can end a result with `HANDOFF → <agent id>: …` (at most 3, at most 3 levels deep). The next agent's task starts on the server when this one is done; for a draft, only after the owner approves it. Handoff lines are never part of what is sent.
  - `NEEDS OWNER: …` puts a question in front of the owner. `POST /api/tasks/:id/answer` restarts the work with the answer.
  - Every outbound draft is read by an **independent reviewer** (QA by default; `review.outbound` in the config, `false` to turn it off) before the owner sees it. A FAIL is shown beside the draft and never sends anything; the owner still decides.
  - Owner controls: **pause and resume the whole office** (`/api/office/pause`, `/api/office/resume`: nothing new starts, not even an approval), cancel, reassign (history kept), reconcile an unknown outcome (`checked` with `sent: true/false`), and `GET /api/pending`, which lists every decision waiting on the owner in plain sentences.
  - Every state change is written into `task.history` with its reason. `npm test` gains 12 coordination checks (40 total), and the browser drill covers a blocked task and the pause.
- A folder named like a note inside `Agents Office/` no longer makes every task fail. Notes record the model that did the work, not the first model the CLI listed.

## 3.6.1-beta.1 — 9 Sep 2026

- **A bigger task box.** The bar is two rows now: the department and the text on top, the model menu, REPEAT and ADD underneath, so the text runs the width of the panel. The box grows as you type, up to six lines, then scrolls. Enter adds; Shift+Enter is a new line.
- **Effort, by name.** An EFFORT menu beside the model: AUTO, Low, Medium, High, Extra high, Max, the levels Claude Code uses. AUTO is the model's own (Opus runs at high). Set it on the task, the routine, the agent (`effort` in the roster) or the office (`effort` in the config), same precedence as the model; every card shows it beside the model name and the note records `effort:`.
- **The big editor.** The ⤢ button inside the box (or ⌘⇧E) opens the same task in a large window with room for a whole brief. It shows the department and the same hint line, ⌘↵ adds, Esc closes, and whatever you type there is in the bar when you close it.

## 3.6.0-beta.1 — 9 Sep 2026

- **Three models, by name.** Sonnet, Opus, Fable. Sonnet is the default for everything, including the routing call. A menu beside REPEAT sets the model for the task you are typing or the routine you are setting; agents take a `model` in the roster; the office default is `model` in the config. The task beats the routine beats the agent beats the office, and every card says which ran and where it was set. Opus runs at effort high; nobody sees an effort setting. Until now every run inherited the login's default model.
- **The usage gauge.** The top bar shows your Claude plan the way Claude Code's usage screen does: session and week, bar and percentage, reset times on hover, amber past 75 and red past 90. Read with the login token Claude Code keeps on this machine, sent only to Anthropic's usage endpoint, never stored. When that endpoint does not answer, the office's own count for the current five-hour window shows instead. No dollars anywhere. A live office shows Claude alone in RUNS HEADLESS ON.
- Three checks: the model table and precedence, the gauge parser and window count, and (live) a task set to Opus running on Opus.

## 3.5.0-beta.1 — 9 Sep 2026

- **Routines: the office runs on its own clock.** A task the office does by itself on a timetable — every weekday at 08:00, every Monday, every hour. Emails, Accounting and Sales in this release; the other departments say "later release" if you try.
- **Three ways to set one.** Type it in the bar with the time in the sentence ("every weekday at 8am, triage the inbox…") and the hint reads the schedule back before you press Add, or press REPEAT and pick a cadence and a time; tell a department lead in chat ("routines", "pause …", "run … now", "delete …" work too); or ask Claude Code, which writes `<brain>/Agents Office/routines.json` (`CLAUDE.md` says how).
- **Where they show.** A SCHEDULED chip in the Task Status panel with a countdown and RUN NOW / PAUSE / DELETE on every routine, a next-up line under the chips, a SCHEDULED column on the company board, a clock chip on the agent's name pill and a routines strip at the top of their chat.
- **The clock lives in the server.** `npm start` fires routines and runs them whether or not the page is open; the page polls and shows the card move. A run missed while the machine slept is caught up once when it comes back, marked LATE.
- **"Needs my OK" is real.** A routine that would send, pay or change anything prepares everything and waits in WAITING ON APPROVAL — the draft in the chat, the agent standing and waving. APPROVE and the agent does the outbound step with its tools; REJECT, say what should change, and it comes back reworked (and the correction is remembered). Read-only routines go straight to DONE. Per-routine switch.
- A live office no longer invents approvals: the theatre asks that used to make a random agent stand and wave are demo-only now, so WAITING ON APPROVAL means a real draft. Real work never waits behind theatre either: a task or routine of yours starts the moment it lands, and the demo job that desk was on is finished.
- Quieter at rest. A live office shows only real reads and writes on the Brain (no theatre glints, no six-second pulse), and the connector loom in the overview runs at about half the ink and half the crawl. Inside a department nothing changed.
- Seven more connector logos: Slack, Google Calendar, Google Drive, Webflow, Playwright, Higgsfield, TerriTool. Anything else still gets an initials tile.
- Routine notes carry `routine:` (and `approved:`) in their front matter. `npm run check` gains six checks: the schedule parser, refusals, the clock and catch-up, the demo bar flow, the API, and (live) a two-minute routine firing end to end.

## 3.4.0-beta.1 — 7 Sep 2026

- Every department now has a lead. Marketing Lead and Operations Lead join at the head of their pods (35 agents). Each runs their team, owns the department's set-up interview, and is where a task lands when Claude cannot pick a specialist.

## 3.3.0-beta.2 — 7 Sep 2026

- The built office page moved from the repo root to `dist/command-centre-v2.html`. Same file, same double-click demo, cleaner repo page. `build.mjs`, `npm start` and the checks all point there.

## 3.3.0-beta.1 — 7 Sep 2026

- **The lead interviews you.** Say "set up" to a department lead. Five questions, one at a time; then it writes a brief for each agent on its team and a skill for the job you described, into your brain, and tells you what it wrote and one task to try. "skip", "done", "cancel". A lead whose department has nothing of yours yet offers this in its greeting.
- **They learn from your corrections.** Every `revise: …` is recorded in `<brain>/Agents Office/feedback/<agent>.md`; Claude sorts it into a one-off or a standing rule, and standing rules go into that agent's prompt from then on. Plain Markdown, yours to edit. `/api/lessons` shows them.
- Roster, skills and lessons are re-read before every task and chat, so a brief no longer needs a restart.
- `/api/health` carries which departments are set up; the boot line says so too.

## 3.2.0-beta.1 — 7 Sep 2026

- **Skills: teach an agent how a kind of work is done.** A folder in your brain, `<brain>/Agents Office/skills/<name>/`, with a `SKILL.md` (when it applies, the steps, the shape, the rules) and the template or example beside it, bound to agents or departments in its front matter. Read in full before every task and chat turn for those agents; the deliverable names the skill it followed and the saved note records it. Re-read from disk on every task, so no restart. Three examples ship in `skills/`. Guide: `SKILLS.md`.
- **Briefs.** A `brief` field on any agent in the roster: standing instructions, up to 2,000 characters, read before every task and chat turn.
- **The roster can live in the brain.** `<brain>/Agents Office/agents.json` is read between the shipped roster and the local file.
- The router sees each agent's skills, so a task that names a kind of work lands on the agent who owns that skill.
- `CLAUDE.md` tells Claude Code how to turn an SOP, a template or a good example into a skill and where to write it. `npm run check` validates skills; `/api/skills` lists what is loaded.
- The shipped roster no longer names anyone: "the owner" throughout.

## 3.1.0-beta.3 — 7 Sep 2026

- One HTML file. The separate dark build is gone; `D` and http://localhost:4520/dark open the same file in dark mode.

## 3.1.0-beta.2 — 7 Sep 2026

- The Brain graph header names your business (it was hard-coded to one company).

## 3.1.0-beta.1 — 7 Sep 2026

- **Connectors are real.** The top bar shows the MCP servers your Claude Code is connected to (`claude mcp list`), not a demo list. Servers that need authentication show grey with the reason on hover and are not wired to any pod. Unknown servers get an initials tile. Nothing connected? The bar says so.
- **Agents use tools.** While they work, agents can call those same connected servers, plus web search (`tools.web`). Bash, file tools and sub-agents stay off. Standing rule: read freely; send, post, pay, delete or change data outside the machine only when the task explicitly asks for that exact action. A deliverable says which tools it used, the note records them, and the logos pulse with the real call.
- **The roster is yours.** `office.agents.json` holds the 33 agents: name, role, what they do, their tools. Override in `office.agents.local.json` (ignored by git). Departments, leads and seats stay fixed. A `CLAUDE.md` in the repo means you can open Claude Code in the folder and say what you want changed.
- `office.config.json` grew `mcp.allow` / `mcp.deny` / `mcp.departments` and `tools.web`; `timeout` (seconds) for long tool runs.
- Live chat now opens with the agent's real job description instead of the demo greeting and sample file.
- `npm run check` validates the roster and the connector endpoint.

## 3.0.0-beta.4 — 6 Sep 2026

- Dark mode: press D, add `#dark=1`, open `command-centre-v2-dark.html`, or visit http://localhost:4520/dark. The scene relights, pods and walkways re-tint, the Brain and wires swap ink.

## 3.0.0-beta.3 — 6 Sep 2026

- No more "demo" label: the panel shows LIVE · CLAUDE when the server is connected and nothing otherwise.

## 3.0.0-beta.2 — 6 Sep 2026

- The Brain strip is gone from the task panel. Open the Brain with G, by clicking the pod, or by its tag.

## 3.0.0-beta.1 — 6 Sep 2026

Agents Office v3 (Beta): the V3 office as a real, installable app.

- Six departments, 33 agents, each with a role, a voice and a task pool.
- Task Status panel with a command bar: type a task, pick the department, the office routes it to the right agent through Claude and the agent produces the deliverable, saved as a note in your brain folder.
- The Brain is your own folder of Markdown notes with `[[wiki links]]`, drawn as a graph over the centre pod, rebuilt live as agents write. `G` opens the full graph with search and a note preview.
- Chat with any agent: real conversation in that agent's persona, grounded in your notes. `revise: …` reworks the last deliverable.
- Runs on your existing Claude Code login, or on an API key if you set one. Nothing leaves your machine except the calls to Claude.
- `npm run check` — the build loop: build, offline smoke, server smoke; `npm run check:live` adds one real task and one chat turn.


## 0.1.0 — 7 Aug 2026

First public release: daemon-based office with inboxes, approvals and an outbox.
