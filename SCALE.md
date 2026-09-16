# Scaling the Explorer's Lab - Procedures for Growth

> **Note (V5 fork).** This checkout no longer matches the document below in one respect: it has
> **twenty departments and 119 seats**, not the six pods and 35 fixed seats that upstream ships and
> that Procedure 1.1 assumes. Renaming a seat is still the right way to repurpose one; the ceiling
> is 119, and routines are open to every department. Everything else here still applies.

Companion to `EXPLORER-SETUP.md` and `EXPLORATION-JOURNAL.md`. This is the **runbook** for making the Agents Office do more as your needs grow. Scale has four axes; each has a concrete procedure below.

> Current state this runbooks assumes: the Explorer Team is live (`office.agents.local.json`), the Brain lives in `brain/` (git‑backed), and `npm start` is running on port 4520.

---

## 0. Prerequisite for everything below

All "scale the work" procedures need Claude to actually call the model. If `http://localhost:4520/api/health` reports `backend: claude-cli` but a live task errors on the router, you lack a usable Claude credential.

```bash
# Option A — Claude Code login (preferred)
claude                  # log in with your account once (browser)
exit
# Option B — Anthropic API key
export ANTHROPIC_API_KEY=sk-...     # put in your shell profile to persist
# Then restart the office in either case
pkill -f serve.mjs && npm start
```

After this, `usage: Claude's gauge…` appears in the server log instead of `office count (no Claude Code login found)`.

---

## 1. Scale the *team* — from 11 seats to more seats

This fork is **20 fixed pods x 119 fixed seats**. You scale by **renaming seats**, not adding them.

### Procedure 1.1 — name a new seat for a new job
1. Open `office.agents.local.json`.
2. Find a **fixed** `id` in the right department whose current `name`/`does` you don't need. Pick by department:
   - marketing (7 seats, ids: `mlead riley newt gfx ada iggy vid`) → learning, research, content, curation
   - delivery (7 seats, ids: `dlead pco qa crep cass dasst ona`) → synthesis, QA, filing, templates
   - ops (6 seats, ids: `olead scout legal comply report dash`) → intelligence, reporting, gamification
   - emails/sales/fin hold the default seats; rename only what you genuinely reassign.
3. Edit only `name`, `role`, `does`, `tools`, `brief`, `model`, `effort` for that id. **Do not touch `id`, `department`, `lead`** — edits to those are ignored and logged.
4. Validate + restart:
   ```bash
   npm run check        # roster: "N customised, M briefed · problems: []"
   pkill -f serve.mjs && npm start
   ```
5. The renamed desk appears in the office on the next page load.

### Procedure 1.2 — give one agent many jobs (skills over seats)
One agent can follow many skills. To add a second job to RESEARCHER:
1. Create `brain/Agents Office/skills/<new-skill>/SKILL.md` with front matter `agents: [riley]`.
2. `npm run check` — it validates the binding; `/api/skills` lists it under `riley`.
3. No restart. The agent reads both skills before its next task.

**Ceiling:** 119 agents total. Idle seats cost nothing, so stay under the cap by leaving unused pods as shipped defaults.

---

## 2. Scale *capability* — connectors and access control

### Procedure 2.1 — connect a real service
```bash
# Connect via Claude Code; the office discovers it on next /api/mcp?refresh=1 or restart
claude mcp add notion     # or google-drive, github, slack, xero, stripe...
claude mcp list           # the office top bar mirrors this
```
The new server appears grey until authenticated; it is **not wired to any pod** until it shows status `connected`.

### Procedure 2.2 — lock a connector to the right departments
Edit `office.config.local.json`:
```json
{
  "mcp": {
    "allow": [],                                   // empty = every connected server is allowed
    "deny": ["Stripe"],                            // keeps Stripe in the bar but out of agent hands
    "departments": {
      "Gmail":   ["emails"],
      "Notion":  ["marketing", "delivery", "ops"],
      "Xero":    ["fin"]
    }
  },
  "tools": { "web": true }
}
```
Rules:
- `allow` empty → everything connected is allowed.
- `deny` → allowed globally but blocked for all agents.
- `departments` → only those pods may call that server. Known brands have built‑in defaults; unknown ones feed every pod.
- `tools.web: false` → agents lose web search (read‑only mode).

Validate: `npm start`, then `curl -s localhost:4520/api/mcp` — each server lists `depts:` and `allowed:`.

### Procedure 2.3 — gate outbound actions
Every routine that *sends, posts, pays, deletes* defaults to **`needsOk: true`**. Leave it on until you trust the agent; flip it off only for read‑only routines (triage, list, reconcile). This is set per routine in `<brain>/Agents Office/routines.json` (`needsOk: true/false`).

---

## 3. Scale the *earning/gamification* loop

### Procedure 3.1 — add a token‑earning skill
Write a skill, bind it, and state the reward in the rules:
```markdown
---
name: insight-harvest
description: How INSIGHT HARVEST curates one social learning gem per day
agents: [iggy]
---
# Curation shift
...
## Rules
- One gem per day maximum.
- File to `90-Knowledge/Insights/YYYY-MM-DD-slug.md`.
- You earn 2 Knowledge Tokens when PROGRESS TRACKER records the find.
```
`npm run check` validates it; the binding shows at `/api/skills`.

### Procedure 3.2 — raise the badge tiers
Edit `brain/90-Knowledge/achievements.md` and tell the GAMIFICATION ENGINE the new ladder. Each unlock is one line: `- DATE · Badge (N tokens) ← reason`. The agent reads this file; you author the tiers.

### Procedure 3.3 — automate the Friday pulse (v3.6 caveat)
Routines are **limited to Emails, Accounting, Sales** in v3.6. So the automated Friday pulse must either:
- **(supported)** run in a Finance stub (e.g. a `fin` routine that calls PROGRESS TRACKER), or
- **(recommended wait)** stay a manual task until v3.7 opens routines to `ops`/`delivery`/`marketing` (the release notes say "later").

When routines unlock for `ops`, add to `<brain>/Agents Office/routines.json`:
```json
{ "id": "friday-pulse", "dept": "ops", "agent": "report",
  "title": "Friday progress pulse + badge check",
  "text": "Run the token tally, update 90-Knowledge/Progress.md, and check 90-Knowledge/Achievements.md",
  "when": { "kind": "weekly", "days": [5], "at": "16:00" },
  "needsOk": false }
```
The server re‑reads `routines.json` every 20 s; no restart.

---

## 4. Scale to *multiple people* — shared brain, parallel offices

### Procedure 4.1 — shared Brain over Git
1. Turn `brain/` into a Git repo (if it isn't already) and push to a private remote.
2. Each teammate clones it and points their office at it: `office.config.local.json` → `"brain": "/absolute/path/to/shared/brain"`.
3. Each teammate keeps their **own** `office.agents.local.json` (git‑ignored) so personal renames don't collide.
4. After any agent writes a note, `git add -A && git commit && git push`; teammates `git pull`. The Brain graph rebuilds on the next `/rebuildGraph` (server does it automatically after each deliverable).

### Procedure 4.2 - when 119 seats isn't enough (parallel offices)
- Run a **second office instance** on another port: copy the folder, set `"port": 4521` in its `office.config.local.json`.
- Give it a **separate brain** (different folder/Git repo) focused on a different domain (e.g. `brain‑research` vs `brain‑delivery`).
- To route work *between* the two, a human issues a task: *"Ask the Research office to explore X and file a note; this office will pick it up."* — i.e. you are the inter‑office handoff until the office is natively multi‑tenant.

### Procedure 4.3 — per‑person vs per‑team licensing
Each live Claude call uses a **Claude Code login**. So the rule is: **one login per person**, never shared. If four people share one login, they share one rate limit and one credential. Scale the *budget* (Claude Teams seats) before scaling the *team*.

---

## 5. The "later" releases — what scaling is waiting on

From the README and server logs:
- **Routines for Marketing / Delivery / Operations** — "come in a later release." Currently `curl -s localhost:4520/api/routines` returns `depts: ["emails","fin","sales"]`; any routine for another department is refused with a clear sentence.
- **Multi‑agent handoff / native multi‑tenancy** — today you hand off by routing a task between offices yourself. The project calls this the "next" capability after the shared‑brain level.
- **Model choice expansion** — the three names (Sonnet / Opus / Fable) are fixed; you can't add a fourth model without editing `src/models.js`.

The safe scaling posture: **stay on the supported path** — rename the seats you need, bind skills, connect only the MCP servers you allow, and wait for the release that opens routines to the pods you need rather than forcing a stub.

---

## Quick reference: commands to remember

| Goal | Command |
|---|---|
| Validate roster + skills | `npm run check` |
| Validate + one live task + one chat | `npm run check:live` |
| Restart after edits | `pkill -f serve.mjs && npm start` |
| List bound skills | `curl -s localhost:4520/api/skills` |
| List connectors | `curl -s localhost:4520/api/mcp` |
| Add a connector | `claude mcp add <name>` |
| View live roster | `curl -s localhost:4520/api/health` |
| Submit a task | `curl -X POST localhost:4520/api/tasks -d '{"dept":"marketing","text":"…"}'` |
| Run a task | `curl -X POST localhost:4520/api/tasks/<id>/run` |
| Submit a chat | `curl -X POST localhost:4520/api/chat -d '{"agent":"riley","text":"…"}'` |
| Trigger the set‑up interview | chat a department lead: **set up** |

---

*Saved alongside the repo at `~/Downloads/AgentsOfficev3ExplorationGithubInsta/SCALE.md`.*
