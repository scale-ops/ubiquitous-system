# Support Metrics: data source audit (2026-10-08)

This is a read-only check of the Airtable tabs the dashboard could read from. Nothing in Airtable was changed.
Where this note disagrees with `HANDOFF.md`, this note is newer and wins.

## Ground rule from Tammy

The manually pulled data is **not** a source of truth. That covers:

- the CSV import in `Issue Report Raw V2 copy` (`tblZ6mdyWTLAoUpEs`),
- the manager's sheet (`QM_Support_Internal_Report_Sheet.xlsx`),
- the hand-typed weekly tabs (`Weekly Ticket Count`, `IPA Request Count`, `WTD Issue Report`, `Linear Ticket RR`).

The dashboard may show these side by side with the computed numbers for comparison. It must never compute from them, and they are **not pass/fail targets for tests**. This replaces handoff section 5 ("the live computation must reproduce these figures").

## Decisions (Tammy, 2026-10-08)

1. **Three streams are tracked:** Slack requests, Linear tickets and QMO / QMA transitions. IPA / RFA stays as its own lens, read from `IPA - RFA Request Data V2`.
2. **The Automated tab is the source of truth**, as long as it covers Linear tickets and transitions. Today it covers neither fully (see the stream table below), so closing that gap is part of the work.
3. **Start and resolved times come from the Automated tab.**
4. **Resolution metric:** left to Claude. Chosen: **"resolved within 24 hours of being opened"**, with "still open" and median / 90th percentile time to resolve beside it. See finding 4.

## The three streams today

| Stream | Where it starts | How it reaches Airtable | In the Automated tab? | Reliable times? |
|---|---|---|---|---|
| **Slack requests** | Slack List "Hub V2 Issue Report Tickets" | Fed automatically and continuously. Rows are not created by any Airtable automation, so it is an outside sync (Slack workflow or integration) | Yes. This *is* the Automated tab | **Yes.** Opened = record created. Resolved = `Time Last Edited` (finding 2) |
| **QMO / QMA transitions** | Until about Sep 14: the same Slack tracker, as platform `QMO QMA TRANSITION`. From Sep 14: Launchpad | Before Sep 14: Automated tab. Launchpad tickets: **one manual import** (`Launchpad Transition Tickets`, all 106 rows created the same day). A separate log, `QMO QMA Transitions`, fills continuously but has no ticket ID and only a text request date | **Only until mid-September** | Partly (finding 7) |
| **Linear tickets** | Linear: teams "[GEN AI] Allocation Ops" and "QM Request Tracker" | **Manual CSV exports** into `Linear Tickets Import`, in batches (for example 184 rows on 2025-08-15 and 155 on 2026-09-10) | **No** | Linear's own Created / Started / Completed times are system-generated and good. The import is the weak link |

## What was checked

All rows were read through the Airtable connector (full tables, not samples):

- `Issue Report Raw V2 ( Automated )` (`tblXOYkhARUXRx5dV`): 10,231 rows.
- `Issue Report Raw V2 copy` (`tblZ6mdyWTLAoUpEs`): 4,992 rows.
- `QMO QMA Transitions` (`tbldHbgRCNRxp0hsA`): 587 rows.
- `Launchpad Transition Tickets` (`tblzMUMhqPwnL3deS`): 106 rows.
- `QMO/A Records` (`tbl4vVCB0h6gaqV7Y`): 3 rows (ignored).
- `Linear Tickets Import` (`tblEW0B2km3qNjPCU`): 1,301 rows.
- `Linear Ticket RR` (`tblIGVnEUGekLHVay`): 84 hand-typed weekly rows.
- Every automation in the base.

Weeks start on Monday. Dates are in Philippine time (UTC+8).

## Findings

### 1. The "copy" tab is one manual import, not a live feed

- All 4,992 rows were created on **2026-10-06** in a single batch. Its data runs from June 2026 to early October.
- 4,988 of its 4,992 Ticket IDs also appear in the Automated tab.
- The `Resolved?` and `Workstream` dropdowns contain the options `"Resolved?"`, `"TRUE"` and `"Workstream"`. These are header text from a CSV that got turned into choices.
- **Decision: do not read this tab.**

### 2. The Automated tab already records opened and resolved times, just not in the "Time" fields

- `Time Started ( PHT )` and `Time Resolved ( PHT )` are **empty on every row**. Ignore them.
- **Opened** = the record's created time (`Time Created in PHT`). In the copy tab, the hand-imported "Time Started" sits a median of 0.6 minutes before this, so it is the same moment.
- **Resolved** = `Time Last Edited` (`fldpBFpPzgBza9wHj`). It changes only when `Resolved?` or `Resolved By` changes. The tab's own `Calculation` formula already uses "Time Last Edited minus Time Created".
- **Check:** for 4,978 of 4,980 tickets in both tabs, `Time Last Edited` is within 5 minutes of the copy tab's "Time Resolved". So that hand-pulled CSV was probably exported from this same signal.
- Caveats:
  - If someone edits `Resolved?` or `Resolved By` later (to reopen a ticket or fix a name), the resolved time moves.
  - Nothing records when an agent **picked up** a ticket. So we can measure "time to resolve", not "time to first response".
- Feed health:
  - One outage: **no tickets from Feb 20 18:35 to Feb 24 01:43 UTC (79 hours).** Every other gap is under 15 hours (overnight or weekends).
  - No bulk backfills: at most 7 rows were created in any one minute.
  - Updates flow through: 8,835 rows were tagged "Open" when they arrived, and 10,220 are now resolved.
- `Ticket Status` is unreliable because the automation that sets "Closed" (`Ticket Status Update`, `wflx72iE6xHk0ndKj`) is **turned off**. Only the "Open" step (`Ticket Update`) runs.
- Ticket counts by record-created month, compared with the manager's sheet:

  | Month | Automated tab | Manager's sheet |
  |---|---|---|
  | May | 1,147 | 1,148 |
  | Jun | 875 | 875 |
  | Jul | 1,264 | 1,266 |
  | Aug | 1,936 | 1,924 |
  | Sep | **1,182** | **1,461** |

### 3. The hand-typed weekly numbers don't agree with the manager's own monthly numbers

- The `Weekly Ticket Count` weeks Aug 3 to Aug 24 add up to 2,007, before counting any of the week of Aug 31. The manager's August month is 1,924.
- Every week from Aug 3 to Sep 28 in the weekly tab is 4% to 13% higher than the Automated tab (for example Aug 24: 620 against 557).

### 4. Why "resolved within 24 hours"

- Counted from the live data, almost every ticket ends up resolved (99.6% to 100% for each week from Aug 3 to Sep 28). A rate that is always about 100% tells management nothing. The manager's lower figures (97.3% to 99.8%) are snapshots of tickets that happened to be open on report day.
- "Resolved within 24 hours of being opened" stays the same once a week is over, can be checked, and moves when the team is stretched. Slack requests only, transitions left out:

  | Week of | Tickets | Within 24 h | Within 72 h | Median time to resolve | 90th percentile |
  |---|---|---|---|---|---|
  | Aug 3 | 285 | 93.0% | 98.9% | 26 min | 19.7 h |
  | Aug 10 | 308 | 93.2% | 97.7% | 39 min | 18.6 h |
  | Aug 17 | 451 | 83.6% | 96.9% | 69 min | 37.0 h |
  | Aug 24 | 510 | **81.0%** | 92.4% | 112 min | 52.8 h |
  | Aug 31 | 363 | 87.6% | 96.7% | 63 min | 33.7 h |
  | Sep 7 | 221 | 87.8% | 92.3% | 50 min | 33.9 h |
  | Sep 14 | 236 | 89.0% | 95.3% | 100 min | 25.2 h |
  | Sep 21 | 176 | 90.9% | 97.2% | 50 min | 17.0 h |
  | Sep 28 | 221 | 91.9% | 96.4% | 37 min | 18.9 h |

- The 24-hour threshold is a judgement call. Tammy can change it to suit a target.
- These figures will shift slightly if the resolved time is later frozen (see "Proposed Airtable changes").

### 5. The "copy" tab's times are not good evidence of work time

- 291 rows have Time Started exactly equal to Time Resolved, which suggests they were typed after the fact.

### 6. CSAT has responses; the scores are almost all 5

- `Support Rating` is filled on 1,765 Automated rows: 1,760 fives, 4 fours and 1 one.
- Responses per month: May 181, Jun 110, Jul 168, Aug 205, Sep 119. That is roughly 10% to 15% of tickets.
- The dashboard should show the response count and response rate next to the score. The scale (1 to 5) and the rule for "satisfied" (4 or more?) need confirming.

### 7. Transitions moved from the Slack tracker to Launchpad in mid-September

- Weekly transition counts by source:

  | Week of | Automated tab (`QMO QMA TRANSITION`) | `QMO QMA Transitions` log | Launchpad (by start) | Manager |
  |---|---|---|---|---|
  | Aug 3 | 60 | 51 | 0 | 0 |
  | Aug 10 | 63 | 50 | 0 | 79 |
  | Aug 17 | 79 | 67 | 0 | 86 |
  | Aug 24 | 47 | 35 | 0 | 50 |
  | Aug 31 | 57 | 50 | 0 | 70 |
  | Sep 7 | 58 | 52 | 0 | 62 |
  | Sep 14 | 5 | 42 | 45 | 55 |
  | Sep 21 | 0 | 21 | **27** | **27** |
  | Sep 28 | 1 | 14 | 18 | 30 |

- From Sep 14, transitions stop appearing in the Automated tab and start appearing in Launchpad. Launchpad matches the manager exactly for Sep 21.
- Before Sep 14, the Automated tab is the closest match, but the manager is still higher in most weeks. That is the same over-count seen in the hand-typed issue weeks (finding 3).
- `QMO QMA Transitions` is a separate log of completed transitions, filled continuously since June. Every row is "Completed", `Handling Time` is never filled, and the request date is text. Each row is written a median of about 20 minutes after the request, which looks like "logged on completion". It has no ticket ID, so it can't be matched to the other two.
- **Launchpad tickets are not in the Automated tab**, and the Launchpad tab is a one-off manual import.

### 8. The 279 extra September tickets are still unexplained

- Automated (1,182) plus Launchpad September (85) gives 1,267. Adding the `QMO QMA Transitions` log (177) gives 1,444, close to 1,461.
- But the same rule would make August about 2,143, not the manager's 1,924. So that is **not** a confirmed explanation. Only the manager can say how September was built.

## Proposed Airtable changes (need Tammy's approval; none made)

To make the Automated tab the single source for all three streams:

1. **Freeze the resolved time.** Add a `Resolved At` date field and an automation that fills it once, when `Resolved?` first becomes `true`, and never changes it after. This protects the number from later edits.
2. **Add a "picked up" time** (optional). This needs a change to the Slack List or workflow so the first agent response is stamped. It would add "time to first response".
3. **Bring Launchpad transitions in.** Either route Launchpad transition requests through the same Slack tracker, or add an automated Launchpad-to-Automated sync. That needs to know where Launchpad tickets come from.
4. **Bring Linear tickets in.** Replace the manual CSV export with a scheduled sync from the Linear API. The handoff's IPA / RFA Redash sync is a working pattern to copy. The Linear connector in this session is not authorised, so the views couldn't be inspected directly.
5. **Turn `Ticket Status Update` back on, or retire `Ticket Status`.** Today it says "Open" on 8,835 resolved tickets.

## How this was produced

The checks ran on connector output saved temporarily in this session. No row-level data, names or emails were saved to the repository. Only the aggregate counts above are recorded here.
