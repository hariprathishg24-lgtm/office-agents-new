# Agents Office — for Claude Code

You are in the Agents Office repo. The owner will most often ask you to change **who the agents are and what they do**, to teach an agent **how a kind of work is done** (a brief or a skill), to put something **on the timetable** (a routine), or to change **which connectors the agents may use**. Do that by editing the JSON files and skill folders described below. Do not touch `src/`, `serve.mjs` or the build for those requests.

## Changing the agents

The roster lives in `office.agents.json` (shipped defaults) and `office.agents.local.json` (the owner's copy, ignored by git). **Always write to `office.agents.local.json`**: if it does not exist, create it with `{"agents": []}` and add only the agents you are changing. Never edit `office.agents.json` unless asked to change the shipped defaults.

Each agent looks like:

```json
{ "id": "newt", "department": "marketing", "lead": false,
  "name": "NEWSLETTER", "role": "Newsletter Creator Agent",
  "does": "Writes the monthly newsletter your signups actually open.",
  "tools": ["beehiiv", "loops"],
  "brief": "Five bullets and a pull quote. Subject lines under 40 characters. Never open with the company name." }
```

You may change **name, role, does, tools, brief, model**. Keep `name` short and upper case (it is the label on the desk). `does` is what the agent reads about itself before every task, so write it as a job description in one or two sentences. `tools` names the connectors this agent usually reaches for (match the names shown in the top bar, lower case). `brief` is the owner's standing instructions to that one agent, read before every task and chat turn: up to 2,000 characters, a string or a list of lines. Anything longer, or anything with steps and a template, is a skill (next section). `model` is `sonnet`, `opus` or `fable`, or empty for the office default (Sonnet); set it only when the owner names one — a task or a routine can still set its own above it. `effort` is `low`, `medium`, `high`, `xhigh` or `max`, or empty for the office's setting and then the model's own (Opus runs at high); same rule, same precedence.

The roster is read in this order, later wins: `office.agents.json` → `<brain>/Agents Office/agents.json` → `office.agents.local.json`. The brain is the folder named by `brain` in `office.config.json` (or `office.config.local.json`, which wins). If the owner keeps their roster in the brain, write there instead of the local file.

Fixed, and the office ignores edits to them: `id`, `department`, `lead`. There are **twenty departments and 119 seats** and that is the office. Do not add or remove agents, departments or pods from the JSON files. When the owner wants a new kind of agent, **rename a seat** in the right department. When they want fewer, leave the seat as is; an idle agent costs nothing.

Department keys: `emails` (5 seats) · `sales` (6) · `marketing` (7) · `ops` (6) · `fin` (4) · `delivery` (7) · `creative` (6) · `success` (6) · `risk` (6) · `growth` (6) · `exec` (6) · `eng` (6) · `data` (6) · `pmo` (6) · `people` (6) · `legal` (6) · `support` (6) · `procure` (6) · `expand` (6) · `product` (6). Every department has a lead and the lead stays the lead.

> **This checkout is a fork.** Upstream Agents Office ships six departments and 35 seats and says so. The five V4 pods (Creative, Client Success, Risk & Compliance, Strategy & Growth, Executive) and the nine V5 capability pods (Engineering, Data & AI, Program Office, People & Talent, Legal, Client Support, Procurement, Expansion, Product & R&D) were added to this copy on purpose, in the source (`src/data.js`, `office.agents.json`, and the per-department lookup tables in `src/main.js`, `src/mcp.js`, `mcp.mjs`, `src/brain.js`, `routines.mjs`, `src/tasks.js`). A `git pull` from upstream will conflict in those files. Adding a *twelfth* department means editing all of them again — every one of those tables is keyed by department and a missing key is a crash, not a warning.

**The officer tier (`exec`).** CEO, COO, CRO, CFO, CGO and a Chief of Staff. Each oversees a cluster of the other nineteen departments — COO: Operations, Delivery, Client Success, Program Office, Client Support; CRO: Sales, Marketing, Creative, Expansion; CFO: Finance, Risk & Compliance, Legal, Procurement; CGO: Strategy & Growth, Emails, People & Talent; and Engineering, Data & AI and Product & R&D report through the COO for delivery and the CGO for capability — reading their outcomes and feedback logs and writing a weekly synthesis. Their standing rule, in every brief: **they synthesise, flag and escalate — they never take an outbound action, and they never approve one on another agent's behalf.** Approval of anything that sends, pays, signs or spends stays with the owner. Do not write an officer brief that loosens this unless the owner asks for it in those words.

After editing: run `npm run check` (it validates the roster and prints every problem), then tell the owner to restart the office (`npm start`). Names, roles and descriptions update on the next page load.

## Teaching an agent how a task is done (skills)

When the owner says "this is how we do X", "make the agent do it this way", "here is our SOP / template / an example I was happy with", or asks why the deliverables are generic, the answer is a **skill**. A skill is a folder with a `SKILL.md` and the files beside it, the same shape as a Claude Code skill. Full guide: `SKILLS.md`. Read it once before writing your first one.

**Where to write it:** `<brain>/Agents Office/skills/<name>/SKILL.md`, where `<brain>` is the folder from `office.config.local.json` → `office.config.json` (`brain`, default `./brain`). Create the folders if they do not exist. Never write the owner's skills into the repo's `skills/` folder; that holds the shipped examples and `git pull` would fight them. A skill of the same name in the brain replaces a shipped one.

**Decide brief or skill first.** Fits in a paragraph with no steps and no template → a `brief` on the agent. Has steps, a shape, rules, or a document to copy → a skill.

**What you need before writing.** The trigger (which tasks this covers), the source material (an SOP, an example, the owner's description), the shape of the finished thing, and the rules. If the owner gave you a document, read it in full first. If one of these is missing, ask one question for it; do not invent the owner's process.

**The folder:**

```
<brain>/Agents Office/skills/proposal/
  SKILL.md       front matter + instructions (under 6,000 characters)
  template.md    the shape of the finished thing, headings kept
  example.md     one real one the owner was happy with (optional, strip anything private the owner did not hand you)
```

**SKILL.md:**

```markdown
---
name: proposal
description: How we write a client proposal
agents: [piper]
---
# Writing a proposal
Use this for any request that ends in a document a client says yes or no to.   ← the trigger, first line

## Before you write
1. …what to read first, by note name (`10-Business/offer-ladder.md`)…
## The shape
Follow `template.md` beside this file, section for section.
## Rules
- short, absolute, one per line
```

**Binding.** `agents: [id, id]` for one or more agents (ids from `office.agents.json`; pick the seat whose `does` matches, and say which one you chose). `departments: [emails]` for a whole department (any key from the twenty listed above). Neither binds it to every agent; only do that for a house style, and say so. Unknown ids are refused and a skill with no valid binding is skipped.

**Limits the loader enforces:** `SKILL.md` body 6,000 characters; each file beside it 4,000, all files together 8,000. Readable files are `.md .txt .csv .json .yaml .html`; anything else is listed by name only. Long reference material goes into the brain as ordinary notes, which the agent reads when the task calls for them; the skill just names them.

**Writing rules.** The first line after the heading says when the skill applies. Steps, then shape, then rules. Point at notes by name. Rules are short and absolute. One skill per kind of work. Never put a number in a skill that should come from the numbers ledger; say where it comes from instead.

**After writing:** run `npm run check` (it lists every skill, its binding and every problem in plain sentences; fix what is red). Skills and briefs take effect on the next task with no restart. Tell the owner: the folder path, which agent it is bound to, and one task to type to try it. Suggest they read the result and send it back with `revise: …` from the chat; when a correction is one they will want every time, fold it into the skill.

**Reading skills back.** http://localhost:4520/api/skills (server running) or `node -e "import('./skills.mjs').then(async m=>console.log(JSON.stringify(m.loadSkills((await import('./config.mjs')).loadConfig().brainPath,(await import('./roster.mjs')).loadRoster().agents).summary(),null,1)))"`.

## Readiness: contracts, fixtures and `npm run coverage`

A brief or a skill says how an agent should work. It does not show the agent can do the job. `npm run coverage` reports every seat's level: **generic** (only the house style), **briefed** (a brief or a department/agent skill exists), **contracted** (a complete capability contract) or **tested** (contract + three fixture cases + a passing review of that exact contract). It writes the full list, with each seat's gaps, to `data/coverage.json`. The first-client seats (`pros enzo ilm lexi folo cmail piper qa dlead pco`) come first.

- **Contract:** `<brain>/Agents Office/contracts/<id>.md` with these `##` sections, none empty: Purpose · Triggers · Required inputs · Boundaries · Allowed tools · Procedure · Output · Quality rubric · Source standards · Escalate when · Worked example. Build it from the owner's own material (their SOPs, approved notes, a skill they signed off). Where something is not established, write that, and never invent the owner's process.
- **Fixtures:** `<brain>/Agents Office/fixtures/<id>/normal.md`, `missing-input.md`, `misleading-input.md`, each a task written as the owner would type it, plus what a good answer must and must not do.
- **Review:** `fixtures/<id>/review.json` → `{ "contractHash": "<first 16 hex of sha256 of the contract file>", "passed": true, "reviewedBy": "owner", "reviewedAt": "<date>", "notes": "…" }`. Only the owner marks a review passed. Editing the contract voids the review.

Readiness is also a limit, not only a label. Outbound work (a send, a post, a payment) from a seat below `readiness.requireForOutbound` in `office.config.json` (default `contracted`; `none` turns it off) is refused at the approval and nothing goes out. Only the owner can override it, with a reason — on the page, by replying `send anyway: <why>`; over the API, `POST /api/tasks/<id>/approve {"override": {"approvedBy": "owner", "reason": "…"}}`. Never send that override yourself, and never lower `requireForOutbound` to get a draft out; both are the owner's call.

## Deadlines, budgets and what a seat costs

A task may carry a deadline and a budget in dollars: `deadline` and `budget` on `POST /api/tasks`, and `POST /api/tasks/<id>/plan` `{ "deadline": …, "budget": { "usd": … } }` to set or move either afterwards. Set them only from what the owner said; do not invent a limit.

- Every run records what Claude charged. A task that has reached its budget will not run, revise or rework again — it appears in `GET /api/pending` as `budget-spent`, and the owner raises the budget or cancels it. A deadline that has passed on unfinished work appears as `overdue`.
- `npm run coverage` (and `GET /api/coverage`) reports per seat: tasks finished, failed, "nothing to send", corrections the owner sent back, drafts the reviewer failed, unknown outcomes, total cost and cost per finished task. Read these before claiming a seat works; they are measurements, not opinions.

## The first-client acquisition workflow

The loop that wins the first client runs as ordinary tasks: research (PROSPECTOR) → qualify (SALES LEAD) → first-touch draft (PROSPECTOR) → QA review → the owner's approval → send, logged with its remote reference → follow-ups (FOLLOW UPS) → proposal (PROPOSALS) → signed → delivery plan (DELIVERY LEAD). Its state is in `data/pipeline.json` (`GET /api/pipeline`).

- **It starts nothing until the owner sets its limits** in `<brain>/Agents Office/acquisition.json`: `outreachPerDayMax`, `followUpDays`, `maxFollowUps`, `spendCeiling` (all required), `deadline` (optional), then `"active": true`. These are the owner's decisions. Never fill them in yourself; if they ask you to, write exactly the numbers they give.
- When active, it advances every 30 minutes on the clock, or on `POST /api/pipeline/advance`.
- The owner reports what happened with `POST /api/pipeline/<key>/mark` `{ "event": …, "note": … }`. Events: `replied`, `interested` (starts a proposal draft), `not-interested`, `opted-out` (never contacted again), `qualified` / `disqualified` (for prospects waiting on review), `signed` (needs a sent proposal and a note saying what was signed; starts the delivery plan), `lost`.
- A prospect with no source URL is rejected, and an unclear fit goes to the owner, never a score. Everything waiting on the owner is in `GET /api/pending`.
- `partnerRates`, `partnerMargin` and `paymentTerms` in the same file are optional and the owner's to set. A proposal states them word for word when they are set; when they are not, it must write "(payment terms to confirm)" or "(price to confirm)" and say partner work needs the partner's own quote. Never write a term, a partner price or a markup the owner has not given.

## Industry research

One research run for the whole office (INTEL, `scout`), not 119 agents browsing. It is configured in `<brain>/Agents Office/research.json`: `runsPerWeek` and `findingsPerRun` (the owner's budget, required), `day` / `at` (when it runs), `staleDays`, and `topics` (`id`, `question`, `roles`). It runs on the clock only with `"active": true`, and never past the weekly budget.

- The server decides what survives. A finding with no URL, publisher, dates or known role is rejected. So is a proposed change with neither a first-party source nor a corroborating URL. An old source is kept but flagged stale and never shown to agents. A finding that would change a price, permission, contract, payment term or commitment is **blocked** and becomes an owner decision. A failed run is a visible gap in `/api/pending`, never a digest.
- Accepted findings reach only the roles they name, labelled as external evidence that never overrides the company notes.
- A finding becomes a rule in a skill only through `POST /api/research/findings/<key>/publish` `{ "skill", "rule", "approvedBy": "owner" }`. Do that only when the owner has said to, in those terms. The previous text is kept in `<brain>/Agents Office/skill-versions/`, and `POST /api/research/rollback` `{ "skill", "why" }` restores it. `GET /api/research` shows what was found, rejected, published and rolled back.
- **Watched pages.** `watch` in `research.json` is a list of `{ id, url, roles, question }` with `watchEveryHours`. The office hashes each page's text; when it changes, one focused run goes to that question, inside the same weekly budget. A change the budget cannot cover, and a page that cannot be fetched, become owner decisions — they are never dropped. `POST /api/research/watch` checks the pages now.
- **Did the rule help?** For every rule the owner published, `GET /api/research` → `effects` compares the affected seats' fixture pass rates before and after it. Worse results ask the owner to roll it back; a rule nothing has measured asks for a fixture run. More notes and longer prompts are not evidence of learning — only the seat's own cases, run again, are.

## Lessons and the set-up interview

Two more things the office writes into the brain on its own. Both are plain files you may edit when the owner asks.

- **Corrections** — `<brain>/Agents Office/feedback/<agent-id>.md`. Every `revise: …` the owner sends lands here, sorted into "## Standing rules" (read by that agent before every task) and "## One-offs". One line each, `- date · rule ← "what the owner said" (task)`. When the owner says "fold the lessons into the skill", "make that a rule", "forget that", or "the agent keeps doing X": read this file, move the durable preferences into the agent's skill (or its `brief` if there is no skill) as short absolute rules, and delete the lines you moved so they are not said twice. Never invent a rule the owner did not give.
- **The interview** — the department lead's chat runs it when the owner says "set up" (`onboard.mjs`). It writes briefs into `<brain>/Agents Office/agents.json` and one skill into `<brain>/Agents Office/skills/<name>/`. An earlier skill of the same name is kept beside it as `SKILL.md.backup-<time>`; if the owner asks you to tidy up, merge what is worth keeping and delete the backup. `data/interviews.json` holds an interview in progress; delete it if one is stuck.

## Routines: tasks on the office's own clock

When the owner says "every Monday …", "each morning …", "on a schedule", "automatically at …", "make X happen every …", that is a **routine**: a task the office fires by itself at that time and runs without anyone typing. **Every department may hold one** (`ALLOWED` in `routines.mjs` is now every department key). Upstream staged this by release; this fork is a self-running firm, so the acquisition engine and the reporting loops each need their own clock. What keeps a routine safe is `needsOk` — anything outbound waits for the owner — not the department list. A routine for a department that does not exist is still refused.

The shipped timetable in `<brain>/Agents Office/routines.json` has sixteen routines and is what makes the office run without the owner typing. The acquisition engine: daily prospect list, enrichment, first-touch drafts, inbound qualification, weekly content, referral asks, re-engagement, and the CRO's channel report. The operating loops: the Chief of Staff's daily pipeline sweep, inbox triage, proposal follow-ups, overdue invoices, renewals/at-risk, the weekly risk review, the Improvement Report, and the CEO's all-hands. Read-only ones run `needsOk:false`; anything that would send, post, pay or spend keeps `needsOk:true`.

**Where:** `<brain>/Agents Office/routines.json` (`<brain>` as above). Create it with `{"routines": []}` if it does not exist. Never write routines anywhere else.

```json
{ "id": "overdue-reminders", "dept": "fin", "agent": "invo",
  "title": "List the overdue invoices and draft the reminders",
  "text": "List the overdue invoices and draft the reminders. Xero read, Gmail drafts.",
  "when": { "kind": "weekly", "days": [1], "at": "09:00" },
  "needsOk": true, "paused": false }
```

- `id` short, unique, lower-case. `dept` one of the three. `agent` an id from the roster in that department; pick the seat whose `does` matches, and say which one you chose.
- `text` is what the agent is asked to do, written as the owner would type it. `title` is the card on the board (under 90 characters).
- `when`: `{"kind":"daily","at":"HH:MM"}` · `{"kind":"weekdays","at":"HH:MM"}` · `{"kind":"weekly","days":[1,4],"at":"HH:MM"}` (0 = Sunday) · `{"kind":"hourly","every":1,"from":"09:00","to":"17:00","weekdaysOnly":true}` · `{"kind":"minutes","every":2}` (filming only). Times are the machine's local clock, 24-hour.
- `needsOk` (default true): the result waits in WAITING ON APPROVAL for the owner's tick before the agent sends, pays or changes anything. Leave it on unless the routine only reads and reports (a triage, a list, a reconciliation), and say which you chose and why.
- `paused: true` keeps it on the timetable without firing.
- `model`: `sonnet`, `opus` or `fable`, only when the owner names one; otherwise leave it out and the agent's or the office's model applies (the task beats the routine beats the agent beats the office).
- `effort`: `low`, `medium`, `high`, `xhigh` or `max`, only when the owner names one; otherwise the agent's, then the office's, then the model's own.

The server re-reads the file every 20 seconds, so a routine lands without a restart; its next run is computed from the moment it is read. Run state (next run, last run) lives in `data/routines.json`, never in the brain file. After writing: run `npm run check` (it validates every routine and names every problem: unknown agent, wrong department, incomplete schedule, duplicate id), then tell the owner the title, the schedule in words, which agent has it, whether it waits for their OK, and that it shows under the SCHEDULED chip with a RUN NOW button to try it straight away.

## Changing the connectors

The top bar shows the MCP servers **this machine's Claude Code** is connected to (`claude mcp list`). To add one: `claude mcp add …` or connect it in claude.ai; the office picks it up on restart. To decide what the agents may call, edit `office.config.json` (or `office.config.local.json`):

```json
"mcp": {
  "allow": [],
  "deny": ["Stripe"],
  "departments": { "Slack": ["emails", "ops"] }
},
"tools": { "web": true }
```

`allow` empty means every connected server. `deny` keeps a server in the bar but out of the agents' hands. `departments` says which pods a server is wired to; unknown servers default to every pod. `tools.web` gives the agents web search.

Agents get only connected servers (plus web when enabled). They never get Bash, file tools or sub-agents. Their standing rule: read freely; send, post, pay, delete or change data outside this machine **only** when the owner's task explicitly asks for that exact action.

## Running the office

`start-office.cmd` starts it and restarts a crash with backoff. It waits 15 s, 60 s, 135 s, 240 s between restarts (PowerShell, not `timeout`, which does not wait without a console) and gives up after 5 quick failures. `PORT` and `AO_LOG_DIR` can be set before it runs. While it is running, do not rewrite it in place — cmd reads a batch file by byte offset; stop the launcher first, then start the new one. `http://localhost:4520/ops` shows problems, decisions waiting on the owner, routines and readiness, with Pause, Resume and Stop. `POST /api/office/stop` stops it on purpose (exit code 3, not restarted). For it to start at logon: `scripts/install-autostart.ps1` (`-Check` to see what is registered). Only run that when the owner asks: it runs routines on their plan while they are logged in.

## Everything else

- `npm run check` is the loop. Run it after any change to code; fix what is red.
- `README.md` says what the product does. Keep it true to the code.
- Release: `node scripts/release.mjs --push` (owner only).
