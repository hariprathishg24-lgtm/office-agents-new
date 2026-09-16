---
name: client-lifecycle
description: The one client note every department reads and moves forward
departments: [sales, success, delivery, fin]
---
# The client lifecycle

Use this for any task about a specific client: prospecting them, proposing to them, onboarding
them, delivering for them, invoicing them, renewing them. It is how work moves between
departments without anyone typing the handover.

## The note

Every client has exactly one note at `Agents Office/Clients/<client-slug>.md`. It opens with
these three lines, in this order, before anything else:

```
Stage: Active Delivery
Owner: delivery
Source: outbound
Last moved: 2026-09-15
```

`Source` is the channel the client came from — `outbound`, `inbound`, `referral`,
`re-engagement`, `partnership` or `paid` (see the `client-acquisition` skill). It is set when the
note is created and never changed afterwards: it is how the office learns which channel works.

`Stage` is one of, in order:

`Prospect` → `Proposal Sent` → `Won` → `Onboarding` → `Active Delivery` → `Renewal/Upsell`

and `Churned`, which any stage can move to. `Owner` is the department key whose stage it is:
`sales` (Prospect, Proposal Sent), `delivery` (Won, Onboarding, Active Delivery), `success`
(Renewal/Upsell), `fin` for anything billing-related at any stage.

## Before you act

1. Read the client's note. **Only act if the stage is yours** (the table above). If it is not,
   say which department owns it and stop — do not do their step for them.
2. If the client has no note, create one at `Prospect`, set `Source` to the channel it came from,
   and say you created it.
3. Read `30-Customers` for what we already know about them, and follow the skill for the actual
   piece of work (a proposal follows `proposal`, a client email follows `client-reply`).

## When your step is done

Append one line to the note's `## History` section — `- YYYY-MM-DD · what happened · agent` —
then update the three header lines to the next stage, its owner, and today's date. Say in your
deliverable which stage you moved it to.

## Rules
- One note per client. Never a second note for the same client.
- Never move a stage backwards. A lost deal is `Churned`, with a reason on the history line.
- Never move to `Won` yourself off a guess: `Won` needs the owner to have confirmed it, or a
  signed document you can point at in the note.
- Anything outbound — sending the proposal, the invoice, the renewal offer — still waits for the
  owner's OK. Moving the stage is not permission to send.
- Never invent a number. Prices come from the offer-ladder note in your COMPANY NOTES, already in
  this prompt — not from Notion, Drive or memory.
