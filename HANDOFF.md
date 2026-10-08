# Support Metrics: handoff to Claude Code

Project: **Support Metrics** dashboard for the PH Support team. Intended home: the `ubiquitous-system` repository, folder `support-metrics/`.
Owner: Tammy (Contractor Operations, Scale AI).
Status as of 2026-10-08: **mockup built and shared for review; no live data wiring yet.**

---

## 1. Goal

Management says they lack good signals on what the PH Support team is doing. A new manager currently builds a report by hand each week and month (see `QM_Support_Internal_Report_Sheet.xlsx`). Tammy wants a **dashboard that replaces that manual report**, with Weekly, Monthly and Quarterly views.

The dashboard answers, in about ten seconds: are we keeping up, are we getting faster or slower, and are people satisfied.

Four lenses, mirroring the manager's four report blocks:

1. **Issue reports** (volume, resolution rate)
2. **IPA / RFA requests** (volume, resolution rate, pending)
3. **QMO / QMA transitions** (volume, resolution rate, average time to resolve)
4. **CSAT** (customer satisfaction)

Plus a "who is resolving what" team view and a data-checks panel.

## 2. What exists today

| Item | Where | State |
|---|---|---|
| Dashboard mockup | `support-metrics/index.html` (one self-contained file, no libraries, Google Font only) | Done. All numbers are hard-coded constants. |
| Redash to Airtable sync for IPA / RFA | Airtable base `appmxzCOba8T4t0YJ`, table `IPA - RFA Request Data V2` (`tblvKbQNw1aoeqlCm`), automation `wfl2mq5eT4n39mdeQ` | **Live, runs every 3 days at 09:00 UTC.** Tested: created 18, updated 5, unchanged 10. |
| Manager's manual report | `QM_Support_Internal_Report_Sheet.xlsx` (sheets: Monthly Trend, August 2026, September 2026) | Reference only. Use it to check the live numbers. |

The mockup was checked by running its script against a stub DOM (all 12 charts build; clicking each button updates every number). **It has not been viewed in a real browser by the assistant.** Tammy was asked to confirm it looks right.

### The IPA / RFA sync (already built, do not rebuild)

- Source: Redash query **313091** "IPA - RFA Request Data" on `https://redash.scale.com`. Owned by another person (Carlos Uy). Parameter `Date_Range` (date range, default `d_this_year`). Its own saved schedule expired 2026-06-28, so it does not refresh itself.
- Target: `IPA - RFA Request Data V2`, 22 columns in query order, primary field `REQUEST_ID`. About 2,264 rows as of Oct 8. Data begins May 28, 2026.
- Automation script (Airtable "Run script" action): finds the newest `CREATED_AT` already in V2, asks Redash only for that date through tomorrow, then creates new rows and updates changed ones, matched on `REQUEST_ID`. Never deletes. First run on an empty table loads `d_this_year`.
- Redash API call that works: `POST /api/queries/313091/results` with body `{"parameters": {"Date_Range": {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}}, "max_age": 0}`, header `Authorization: Key <key>`, then poll `GET /api/jobs/<id>` until `status == 3`, then `GET /api/query_results/<query_result_id>`.
- The Redash API key is stored as an **Airtable secret named `REDASH_API_KEY`** (id `eachffdXPCpMrYeYf`). **Never put the key in the repo, in chat, or in client-side code.**
- Airtable script environment gotchas: `setTimeout` does not exist (the script busy-waits on `Date.now()`), and the run limit is 180 seconds.
- Known limitation: requests created before the last import date never get status updates. A `LOOKBACK_DAYS` constant near the top of the script (currently `0`) can widen the window (for example `7`).

## 3. Decisions already made

- Mockup first, then live data. After reviewing the mockup, Tammy asked for a Quarterly view and for this handoff.
- Default view is **Weekly**. The quarterly IPA / RFA rate hides a September slide (99.4% July, 98.8% August, 96.5% September), so Weekly is where problems show. Tammy has not yet confirmed whether management should land on Weekly or Quarterly.
- Layout: plain-language summary first (with a "Copy this summary" button), then a short "what needs a look" list, then four bands (big number, change, chart, "how it is calculated"), then the team view and data checks.
- Every number must come from the source tabs. No hand-typed weekly tabs.
- Use `Resolved?` as the resolution signal for issue reports, not `Ticket Status` (see section 6).

## 4. Data sources (Airtable base `appmxzCOba8T4t0YJ`)

### 4.1 Issue reports

**Live source: `Issue Report Raw V2 ( Automated )`, table `tblXOYkhARUXRx5dV`.** 10,227 rows.

| Field | ID | Notes |
|---|---|---|
| Ticket ID | `fldgCS20KjeM7KT3p` | |
| Resolved? | `fldggm5sX3QKKjomR` | single select, text values `"true"` / `"false"` (10,214 true, 13 false) |
| Time Started ( PHT ) | `fldE8jhDB4FTDNv6d` | dateTime |
| Time Resolved ( PHT ) | `fldRelgfLFo9BW48K` | dateTime |
| Time Created in PHT | `fldOjFvbJrWdKtCtR` | createdTime |
| Resolved By | `fldCJ6cEVwPOzsfsJ` | text |
| Support Rating | `fldiMcuLqfhy9FGsG` | number, CSAT input |
| Platform / Issue Type / Workstream | `fldFrsxoqScOzCWBu` / `fldTwQHzQcc4oyYrm` / `fld4Uy4NteULQa5V4` | for filters |
| Resolution Time (minutes) | `fldbXUmvEun5Q9ORA` | formula |
| Ticket Status | `fldzubiY3rWcagHoq` | **do not use** (see section 6) |

Related, not yet analysed: `Issue Report Raw V2` (`tblYDP3J4A5344xbJ`, has a `CSAT %` formula `fld8EbKXRAMFu1CqQ` and a `Solved By (Stats)` link), `Issue Report ( Raw )` (`tblEcfnf2IRDkGKhf`), `Archived` (`tblOnzOXKExSnxO1d`, old tickets), `Issue Report Raw V2 copy` (`tblZ6mdyWTLAoUpEs`).

**Hand-typed weekly feeds (to be replaced by computation):**
- `Weekly Ticket Count` (`tblVGf5Uv7R88vV72`): `Week Date` `fldo8I5jJ6muKsGMT`, `Total Tickets` `fldRFBR7XBx5x0V3Y`. 87 weeks, 2025-02-03 to 2026-09-28. Tammy calls this tab "the clearest signal." Week of Oct 5 is not entered yet.
- `WTD Issue Report` (`tbl39kr5lkHieDc8a`): `Week Date`, `Resolution Rate`. Not inspected.

### 4.2 IPA / RFA requests

- `IPA - RFA Request Data V2` (`tblvKbQNw1aoeqlCm`). Key fields: `REQUEST_ID` `fldYdb9wwzIi8RBId`, `CREATED_AT` `fldPGfN5vhkb7aWTF` (date), `COMPLETED_AT` `fldpag3rCG9kDevQB` (date), `TICKET_STATUS` `fldXTJuVYOWNblz2H` (text with emoji, for example `pending 🟡`, `completed 🟢`, `completed 🔴`), `NUM_CBS_IN_TICKET` `fldDvzMrBxHbyIEl5`. The `% ...` columns are text.
- Hand-typed weekly feed: `IPA Request Count` (`tblXY0ZcYcCrIIlkq`): `Week Date` `fldf2g8dfHjVBbvLd`, `Total Request Count` `fldbyrEtRH9xeIFpk`, `Total Request Resolved` `fldVBv5XGH5Gura0q`, `Total Request Pending` `fldG4bp8uBxvrdMKo`, `Resolution Rate` `fldJc0kOXpvUVLlja`. 9 weeks, Aug 3 to Sep 28. Rate = resolved / total.
- **Privacy:** V2 contains requester emails and free-text approver notes. The dashboard should show **aggregates only**. Do not ship row-level data to the browser.

### 4.3 QMO / QMA transitions

Which tab feeds the manager's counts is **unconfirmed** (see section 7). Candidates:

- `Launchpad Transition Tickets` (`tblzMUMhqPwnL3deS`): the live tab, 106 rows. Key fields: Status `fldZxFDbao5OZVJVn`, Time Started (PHT) `fldlSbOPFrn4x9fzM`, Time Resolved (PHT) `fldPkNB7ChIFAMQ1K`, Resolved by `fldzR2M6sbx48g92d`, Resolution time in minutes `fld75aijbkMdvrmyh`, Rate the support `fld2bAia6mn4Tam5h`.
- `Launchpad Transition Tickets copy` (`tblIrWykHzED4HOKy`): 72 rows, **all created 2026-09-28**, so it is a snapshot. Tammy asked to look at this one; recommend reading the live tab instead once confirmed.
- `QMO QMA Transitions` (`tbldHbgRCNRxp0hsA`): Completed by, Transition Status, Request Date (text), Handling Time (duration). Not inspected. Also `QMO/A Records` (`tbl4vVCB0h6gaqV7Y`). Not inspected.
- **Ruled out:** `Linear Ticket RR` (`tblIGVnEUGekLHVay`). Its weekly counts (Sep 28: 26, Sep 21: 9, Sep 14: 8, Sep 7: 5, Aug 31: 19, Aug 24: 45, Aug 17: 72, Aug 10: 28, Aug 3: 1) do not match the manager's (30, 27, 55, 62, 70, 50, 86, 79, 0).

### 4.4 Other useful tabs

`Solved By Stats` (`tblZ7arjlgcoQRoeO`, per-person tickets solved and average resolution), `PH Holidays` (`tbl4eN0WLlyIZFG0c`), `Leave Plots` (`tblsdXjygSNML72C3`), `Shift Schedules` (`tblKgex1ian6J2YEF`), `Team Member Emails` (`tblgp5VmdnAOz8j7r`).

## 5. Metric definitions and acceptance numbers

The live computation must **reproduce these figures** (taken from the manager's sheet and the weekly tabs). Weeks start Monday. Excel serials in the sheet: `46237` = 2026-08-03.

| Week of | Issue tickets | Issue resolved | IPA requests | IPA resolved | Transition tickets | Avg minutes to resolve |
|---|---|---|---|---|---|---|
| Aug 3 | 373 | 99.46% | 117 | 98.29% | 0 | |
| Aug 10 | 415 | 99.76% | 160 | 100% | 79 | |
| Aug 17 | 599 | 98.83% | 267 | 98.50% | 86 | |
| Aug 24 | 620 | 98.06% | 348 | 98.56% | 50 | |
| Aug 31 | 466 | 99.79% | 204 | 96.57% | 70 | |
| Sep 7 | 298 | 98.99% | 122 | 97.54% | 62 | |
| Sep 14 | 264 | 98.48% | 122 | 95.90% | 55 | 31 |
| Sep 21 | 184 | 97.28% | 100 | 96.00% | 27 | 249 |
| Sep 28 | 249 | 97.99% | 110 | 96.36% | 30 | 352 |

Monthly (manager's sheet): issue tickets May 1,148 / Jun 875 / Jul 1,266 / Aug 1,924 / Sep 1,461; IPA requests May 60 / Jun 372 / Jul 473 / Aug 892 / Sep 658; transitions Jul 163 / Aug 190 / Sep 244; CSAT 100% every period.

Quarterly (computed for the mockup): issue volume from whole Monday-start weeks in `Weekly Ticket Count`: Q2 2025 14,389 / Q3 2025 6,991 / Q4 2025 4,111 / Q1 2026 3,609 / Q2 2026 3,520 / Q3 2026 4,865. Quarterly rates are volume-weighted from the monthly sheet (issue: Q2 98.34% for May and June only, Q3 98.71%; IPA: Q2 98.15%, Q3 98.19%).

Definitions to implement (confirm against the figures above; the manager's exact formulas were not given):
- **Resolution rate** = resolved ÷ created in the period. IPA's rate is confirmed this way (for example 106 ÷ 110 = 96.36% for Sep 28).
- **Average time to resolve** = mean of (Time Resolved − Time Started) in minutes for tickets started in the period. Recorded only from Sep 14 for transitions.
- **CSAT** = Support Rating converted to a percentage. Also show **how many people answered**.
- **The week of Sep 28 straddles Oct 1 to 4**, so calendar-quarter totals computed from ticket dates will differ slightly from the mockup's whole-week quarterly totals. This is expected; document which basis the live version uses.

## 6. Known data-quality issues

1. **`Ticket Status` is unreliable** on `Issue Report Raw V2 ( Automated )`: "Open" on 8,831 rows, blank on 1,387, "Closed" on 9, while `Resolved?` says 10,214 resolved and 13 open. Use `Resolved?`.
2. **Launchpad copy is a snapshot** (72 rows, all created on 2026-09-28). The live tab has 106.
3. **Transition counts do not reconcile.** The manager reports 244 for September; the Launchpad tab holds 106 in total.
4. **Weekly tabs are typed by hand** and the manager's monthly numbers cannot be reproduced by adding up weeks, because weeks straddle months.
5. **CSAT is exactly 100% every week since May.** That usually means very few responses. Needs a response count.
6. **Time zones:** fields are labelled "PHT" but Airtable stores absolute times. Before bucketing by week, check each field's configured time zone and a few sample rows. Example: Launchpad record started `2026-09-26T13:51:00.000Z`.

## 7. Open questions for Tammy (ask before building)

1. **Which tab feeds the manager's transition counts** (163 / 190 / 244 per month)? Candidates are in 4.3. This was asked and is still unanswered.
2. Should the default view be Weekly or Quarterly for management?
3. Where does this page live and how is it deployed (the `ubiquitous-system` repo layout, hosting, CI)? Who can see it? Is a login needed?
4. Show **named individuals** in the team view, or anonymise? The mockup uses "Teammate 1 to 6" with placeholder values.
5. Targets: what resolution rate and time-to-resolve count as good (for red/amber/green)?

## 8. Mockup structure (`index.html`)

Single file. Script constants to replace with data loaded from JSON:

- `W9`, `M5`, `Q6`, `Q2`: axis labels.
- `lenses[]`: per lens `id` (`issue`, `ipa`, `transitions`, `csat`), `name`, `src`, `calc`, `note`, and chart data objects `weekly`, `monthly`, `quarterly` (each `labels`, `prefix`, `bars`, `line`, `barName`, `lineName`, `lineFmt`, `lineMin`, `lineMax`), plus `qnote` (extra caveat shown only in Quarterly).
- `views[lensId][mode]`: big number, unit, change text, `cls` (`good` / `bad` / `flat`) and one-line note.
- `stories[mode]` (heading and summary paragraph), `watches[mode]` (attention list), `team[]` (placeholder), `health[]` (data checks).
- Functions: `drawChart(host, d, readoutEl)` (hand-built SVG bars plus line, hover and keyboard focus readout), `renderBands`, `drawAll`, `renderLead`, `setMode`.
- Design tokens: ink `#12272C`, teal `#0F6E73`, soft teal `#CDE5E6`, paper `#EEF3F4`, red `#B3332D`, amber `#A85F00`, green `#2B7A4B`. Font: Atkinson Hyperlegible. Do not accent colour alone; every status also has text.

## 9. Recommended build plan

Do these in order and confirm each with Tammy before moving on.

1. **Resolve the open questions** (section 7), especially the transition source.
2. **Write a metrics builder script** (for example `scripts/build-metrics.mjs`): reads Airtable through the REST API (paginated), computes weekly, monthly and quarterly metrics per lens (PHT, Monday weeks), and writes `data/metrics.json`. The summary text and attention list should be generated from the numbers, not typed.
3. **Add tests** that assert the acceptance table in section 5. If a number does not match, stop and explain why before changing the definition.
4. **Change `index.html`** to load `metrics.json` instead of constants. Keep the layout and views.
5. **Schedule the build.** The IPA sync runs every 3 days at 09:00 UTC, so schedule the build shortly after. Pick a mechanism that matches the repo's hosting (for example a scheduled CI job) and confirm with Tammy.
6. **Retire the hand-typed tabs** (`Weekly Ticket Count`, `IPA Request Count`) only after the dashboard matches them for several weeks. **Do not delete them without explicit approval.**
7. **Then the extras** (all optional, in this order of value): targets with automatic red/green; median and 90th percentile instead of averages; open tickets by age; filters by platform, workstream and issue type; arrivals by hour and weekday (PHT) for staffing; holiday and leave overlays; a Monday Slack post of the summary; alerts when a rate drops below target.

**Security rules:** use a **read-only Airtable personal access token scoped to this one base**, stored as an environment variable or CI secret. Never commit tokens. Never expose the token or row-level data in the browser. Do not read or print `REDASH_API_KEY`.

## 10. Working agreements with Tammy

- She prefers **numbered, small steps with explicit check-ins**, and wants the **expected output explained in advance** and each step **confirmed as non-destructive** before it runs.
- Ask before anything that writes, deletes or schedules. Reads are fine.
- Be plain about what was and was not verified. Say when something was tested only with a stub, or not tested at all.
- She is the decision-maker for what management sees; flag judgement calls (such as naming individuals) instead of deciding them.

## 11. What was not done

- No access to the `ubiquitous-system` repository was available, so the file layout there is unknown.
- The mockup has not been viewed in a real browser by the assistant.
- Not inspected: `QMO QMA Transitions`, `QMO/A Records`, `WTD Issue Report`, `Issue Report Raw V2` (the non-automated one), and the Redash query's SQL (the connector returns metadata only).
- Nothing was changed in Airtable by the dashboard work. The only live automation is the IPA / RFA sync described in section 2.
