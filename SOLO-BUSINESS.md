# Retainer business workflows

Configured for Origin Pixel Solutions: design, development, marketing and automation, primarily delivered through retainers. These details come from the owner's messages and supplied business cards. Client counts, fees, contract terms, connected apps and performance results have not been assumed.

Open `/solo` for the all-in-one client workspace, described in [ORIGIN-PIXEL-OS.md](ORIGIN-PIXEL-OS.md). The catalogue now lives inside Business → Automations, or directly at `/solo/advanced`. It covers 40 workflows across retainers, opportunities, sales, delivery, decisions, knowledge, contractors, personal planning, continuity and improvement.

## Installed capability

Each workflow has an assigned agent, required inputs, procedure, expected output and proposed schedule. “Prepare now” creates a real task through the existing office task engine. Results appear on the page and in the office. Schedule controls use the existing persistent routine engine. The operations page retains its approvals and action history.

These are report and draft workflows, not new direct integrations or a fully autonomous business. Their procedures prohibit external mutations and agent dispatch. Agents use the existing authorized tools; missing information must be reported. The catalogue does not verify that an app is connected. It does not implement event webhooks, automatic payments, bookings or publishing. Scheduling requires the office server to remain running and uses the server computer's timezone.

## Setup

Run `node scripts/install-solo.mjs` to add missing routines and ten scoped operating skills to the configured brain. Installation preserves existing routines, existing skill files and edits. New routines start paused to avoid spending model usage on unavailable inputs. The installer backs up the routine file before adding entries. Restart the server after installing this code to make `/solo` available.

Start with retainer month planning, allowance tracking, client health, recurring billing and monthly value reporting. Inspect each first result, then enable useful schedules individually. Proposed weekly review schedules do not determine invoice periods: those must come from actual contracts.

## Records needed for live usefulness

Supply these through your existing authorized business notes or connected apps:

- Retainer accounts: client ID, active status, agreed services, billing period, fee, currency, included units/hours, rollover rules, exclusions, revision limits, service commitments, renewal date and notice window.
- Work: client ID, period, deliverable, owner, deadline, status, approved time/cost, dependencies and approval evidence.
- Payments: client ID, period, invoice ID, amount, currency, due date, paid status and any dispute. Keep credentials out of notes.
- Outcomes: agreed goals, actual metrics, source, measurement period and baseline.
- Preferences: working hours, capacity, time off, escalation rules and approved contact policies.

No sample accounts, fees or contracts are installed. The existing business name and policies are preserved. Confirm the customer communication, calendar, project and billing apps before claiming end-to-end connectivity.

## Operating boundaries

“Prepare now” supplies its context only to that task; it does not silently change future schedules. The page refreshes every 15 seconds. “Pause enabled solo schedules” pauses only this catalogue's future firings; it does not stop tasks already running or other office routines. Use operations for existing task controls.

The workflows provide proposed handoffs and operating plans, not automatic multi-stage execution. External execution remains a separate explicitly authorized office task. Scenario output is an estimate with assumptions, and missing metrics are unknown rather than zero.

## Validation

`node --test test/solo.test.mjs` checks installation, preservation, invalid-data handling and paused scheduling. `npm run check` runs the existing application checks. Live output quality still needs validation with your actual records and connected account.
