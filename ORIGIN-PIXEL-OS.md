# Origin Pixel OS

Open http://localhost:4520/solo while the office server is running. The old workflow catalogue is under Business → Automations, also available at `/solo/advanced`.

## First client

1. Set up business preferences: name, working hours and optional weekly capacity.
2. Add the client, agreed services, period fee and currency. Paste their actual agreement and goals. Optional unknown values can remain blank.
3. Open the actual contract period. Fee, currency, allowance and agreement text are captured as a snapshot, so editing the client later does not rewrite old periods.
4. Add requests. Included work is checked against the recorded hours allowance. Unclear and additional scope waits for a recorded decision.
5. Move work through production, submit a deliverable reference, record approval evidence for that version, and mark delivered. A replacement version invalidates the previous approval while preserving its audit snapshot.
6. Prepare an internal invoice record. Record Issued only after external issuance; record Paid only with evidence. The app does not issue invoices, calculate taxes or collect payments.
7. Close the period when requests are delivered or cancelled and the invoice is recorded paid. Open the next period using its actual agreement dates.

## AI uses Claude Code CLI

Choose Ask AI or AI & reports on a client. The server builds factual context from that client's agreement, periods, requests and invoices and queues a read-only task through the existing Claude Code CLI execution path. The UI shows task status and result, polling every eight seconds. Closing the page does not stop a server-owned task. An in-flight duplicate for the same client and workflow is returned rather than creating another.

This endpoint requires the `claude-cli` backend and a discoverable CLI. API-key mode is explicitly refused for these tasks. Existing office login, model configuration, tool permissions and execution limits apply. A connection label indicates the configured backend, not guaranteed login health; a failed task reports its result/error.

Reports and drafts do not automatically become work items or trigger customer communication. No automatic agreement extraction, external synchronization, file uploads, client portal or unattended cloud hosting is claimed. Clients and agreement text are entered through the form; files are referenced by link or path. These are the next integration stages, not simulated features.

## Persistence and safeguards

Structured records live in the configured data directory's `business.json`, with the existing atomic-write and previous-copy-backup mechanism. The schema is versioned. Every successful command increments a revision, and stale saves are rejected. Each record mutation keeps an audit snapshot. Invalid dates, overlapping periods, duplicate invoice periods/references, unsupported status changes, stale approvals and premature period close are rejected server-side.

The interface is owner-only and served on the existing loopback server. It must not be exposed publicly without authentication, authorization and a separate deployment review. Exports are available under Business. There is no destructive delete in this release.

Hours shown on requests are estimates, not a time-tracking ledger or calculated profitability. Additional scope decisions do not silently increase the included allowance or invoice amount. Recorded invoice totals are grouped by currency. A full accounting integration is still required for tax, credits, partial payments and reconciliation against providers.

## Verification

- `node --test test/business.test.mjs`: record lifecycle, evidence, optimistic concurrency, periods, scope limits, approval versions, invoice duplication and CLI task execution with the isolated fake backend.
- `node test/business-browser.mjs`: complete setup-to-period-close browser journey, persistence after reload, CLI task submission, desktop/mobile rendering.
- `npm run check`: existing application checks.
- A separate minimal real CLI probe returned `CLI_READY`; no test clients were added to the real business store.
