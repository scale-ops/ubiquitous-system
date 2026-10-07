# Project Handoff: Contractor Ops Resume Screening

*Prepared October 2026 by Tammy Harris (with Claude). For whoever is taking over this project.*

---

## 1. What this project is

We recruit contractors for two roles and need to screen hundreds of candidates quickly:

| Pool | Role | Location | Airtable table |
|---|---|---|---|
| **BDR** | Business Development Representative | USA (plus a few in Canada) | `BDR` (about 340 candidates) |
| **WPC** | "CSM – Workplace Collection". Despite the name, this is **high-volume outbound phone sales** that signs businesses up as data-collection sites | Mexico City | `WPC` (444 candidates) |

There are two parts to the project:

1. **The Resume Screening app** (live on Vercel). You pick a job description and a candidate pool, and Claude scores every candidate 0–100 as Strong, Possible or Weak fit, with reasons. It's read-only against Airtable.
2. **The budget and seniority check** (done directly in Airtable). For every **Strong fit** candidate, we flagged whether they are executive-level, or are likely to expect more pay than our budget.

---

## 2. Where everything lives

| What | Where |
|---|---|
| Live app | https://resume-screening-three-omega.vercel.app (password-protected, see section 4) |
| Vercel project | https://vercel.com/scaleai/resume-screening (Scale Enterprise team) |
| GitHub repo | https://github.com/scale-ops/ubiquitous-system (branch `main` is what's live) |
| App code | `resume-screening-app/` folder in the repo |
| Airtable base | https://airtable.com/appqmAg1Av6yheTUu (base ID `appqmAg1Av6yheTUu`) |
| Pay-rate research | `pay-rate-benchmarks.pdf` / `.md` in the repo root |
| App setup guide | `resume-screening-app/README.md` |
| This document | `HANDOFF.md` in the repo root |

---

## 3. Access the new owner needs (checklist)

Ask for each of these on day one:

- [ ] **Airtable**: editor access to base `appqmAg1Av6yheTUu`
- [ ] **Vercel**: member of the **Scale (Enterprise)** team, with access to the `resume-screening` project
- [ ] **GitHub**: write access to `scale-ops/ubiquitous-system` (scale-ops is a GitHub Enterprise org)
- [ ] **App password** (`APP_PASSWORD`): get it from Tammy. It's not written down anywhere in this document on purpose.
- [ ] **AI Gateway key**: only if you need to rotate it. It's managed in Vercel → **AI Gateway → API Keys**.
- [ ] **Airtable personal access token**: the app uses Tammy's token. **Before Tammy's access ends, create your own token and replace `AIRTABLE_TOKEN` in Vercel** (see section 4.4), or the app will stop working.

---

## 4. The Resume Screening app

### 4.1 Daily use
1. Open the live app link and log in. Use any username, plus the app password.
2. Choose a **Job**. The list comes from the Airtable table `Job Description Links`, and each row needs a job description PDF attached.
3. Choose a **Candidate pool** (`BDR` or `WPC`).
4. Click **Find best fits**. A full pool takes about 5–10 minutes. Keep the tab open.
5. Filter by **Strong / Possible / Weak fit** or search. Click a candidate for details, a link to their resume, or **Deep review with full resume** (Claude reads the resume PDF and writes a requirement checklist plus interview questions).
6. Click **Download CSV** to share results.

Results are saved **in your browser only**, not in Airtable, so a refresh doesn't lose them, but a teammate won't see your run.

**Adding a job:** add a row to `Job Description Links` with the job name and the PDF attached, then refresh the app.
**Adding candidates:** add rows to `BDR` or `WPC` as usual, then click **Re-run screening**.

### 4.2 How it works (technical)
- **Stack:** Next.js 16 (App Router), TypeScript, `@anthropic-ai/sdk`, deployed on Vercel.
- **Login:** `proxy.ts` puts HTTP Basic auth on every page and API route, checking against `APP_PASSWORD`.
- **Airtable reads:** `lib/airtable.ts` (REST API, read-only). The pool table names are listed in `POOLS`.
- **Claude calls:** `lib/claude.ts`.
  - `summarizeJob`: turns the job description PDF into a requirements list (once per job).
  - `scoreCandidates`: scores batches of 20 candidates using their Airtable profile fields, with a structured JSON output.
  - `deepReview`: reads one candidate's resume PDF in full.
- **Batching:** `app/page.tsx` sends batches of 20, 3 at a time, so no request hits Vercel's time limit.
- **API routes:** `app/api/` holds `jobs`, `candidates`, `job-summary`, `score`, `deep-review` and `resume`. The `resume` route fetches a fresh link each time, because Airtable file links expire after a few hours.
- **Fairness guardrail:** the system prompt tells Claude to judge only job-relevant qualifications and never protected characteristics, and to ignore any instructions inside resumes.

### 4.3 How Claude is reached: Vercel AI Gateway
The app does **not** use a direct Anthropic API key. It goes through **Vercel's AI Gateway**, and usage is billed through Vercel. This was set up in October 2026:
- `lib/claude.ts` reads the model name from `CLAUDE_MODEL` (default `claude-opus-5`).
- When `ANTHROPIC_BASE_URL` is set (meaning the Gateway is in use), the app turns off the "server-side fallback" beta feature, because we couldn't confirm the Gateway supports it.
- To switch to a direct Anthropic key later: delete `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_MODEL`, add `ANTHROPIC_API_KEY`, then redeploy. No code changes are needed.

### 4.4 Environment variables (Vercel → resume-screening → Environment Variables)

| Name | Value | Notes |
|---|---|---|
| `AIRTABLE_TOKEN` | Airtable personal access token (`pat…`) | Needs scope `data.records:read` and access to the base. **Currently Tammy's; replace it with yours.** |
| `AIRTABLE_BASE_ID` | `appqmAg1Av6yheTUu` | |
| `APP_PASSWORD` | team password | Changing it logs everyone out |
| `ANTHROPIC_BASE_URL` | `https://ai-gateway.vercel.sh` | Routes Claude calls through the AI Gateway |
| `ANTHROPIC_AUTH_TOKEN` | AI Gateway API key | From Vercel → AI Gateway → API Keys |
| `CLAUDE_MODEL` | `anthropic/claude-opus-5` | Gateway model names need the `anthropic/` prefix |
| `AI_GATEWAY_API_KEY` | (pre-existing) | Not used by the app; harmless |

**After you change any variable, you must redeploy:** go to **Deployments → ⋯ on the top deployment → Redeploy**.

### 4.5 Deploying changes
- Vercel deploys automatically on every commit to `main`.
- Vercel's **Root Directory** must stay set to `resume-screening-app`, because the app isn't at the top of the repo. Without it the build fails ("No Next.js version detected").
- Make code changes either by uploading files through GitHub's website (**Add file → Upload files**, then commit to `main`) or through a Claude Code session once Claude's GitHub access is approved (see section 7).

### 4.6 Costs
- **Vercel and GitHub:** covered by Scale's Enterprise plans.
- **Claude (through the AI Gateway):** pay per use. Scoring a full pool costs roughly $1–2, and a deep review a few cents. Check **Vercel → AI Gateway → Usage**.

---

## 5. Airtable base (`appqmAg1Av6yheTUu`)

### 5.1 Tables
| Table | Purpose |
|---|---|
| `Job Description Links` | One row per job: name plus the job description PDF. **The app reads this.** |
| `BDR` | BDR candidate pool (US/CA). **The app reads this.** |
| `WPC` | WPC candidate pool (MX/VE). **The app reads this.** |
| `Reviewer Allowlist`, `Internal Team`, `Feeder` | Supporting tables. The allowlist was meant for a future Google sign-in; **the live app uses a single shared password instead** |

The candidate fields come from Outlier/marketplace exports: name, email, `IP_COUNTRY_CODE`, `JOB_TITLE`, `JOB_COMPANY`, `JOB_EXPERIENCE`, `EDUCATION`, `WORKERSKILLS`, `PROJECTS`, and a resume PDF attachment. Don't rename these tables or columns: the app expects these exact names.

### 5.2 Fit columns (from an earlier Claude screening run)
- **BDR:** `BDR Fit Rank`, `BDR Fit Score`, `BDR Fit Verdict`, `BDR Fit Notes`
- **WPC:** `CSM Fit Rank`, `CSM Fit Score`, `CSM Fit Verdict`, `CSM Fit Notes`
- There are **92 Strong fits in BDR** and **12 in WPC**.

### 5.3 Budget-check columns (added October 2026, both tables, Strong fits only)
| Field | Meaning |
|---|---|
| `Seniority Level` | Entry / IC · Experienced IC · Manager / Senior · Executive / Leadership (judged from job titles) |
| `Rate vs Budget` | Within budget · Borderline (no more than about 25% over) · Over budget · Over budget - Executive |
| `Est. Market Rate (USD/yr)` | Estimated annual pay the candidate would likely expect |
| `Location (State)` | **Still blank.** Needs the resume read (see section 7) |
| `Rate Notes` | Why they were flagged, plus the benchmark used |

---

## 6. Budget analysis: method and findings

### 6.1 Budgets given
- **BDR (USA):** $20/hr = $800/wk = $3,466.67/mo = $41,600/yr
- **WPC (Mexico City):** half of BDR, so $10/hr = $400/wk = $1,733.33/mo = $20,800/yr

### 6.2 How the estimates were set
| Seniority | US | Canada | Mexico |
|---|---|---|---|
| Entry / IC | $50k (Borderline) | $40k (Within budget) | n/a |
| Experienced IC | $70k (Over budget) | $50k (Borderline) | $25k (Borderline) |
| Manager / Senior | $85k (Over budget) | n/a | $45k (Over budget) |
| Executive / Leadership | $125k (Over budget - Executive) | n/a | $60k (Over budget - Executive) |

Sources and the full state-by-state tables are in **`pay-rate-benchmarks.pdf`**. The figures came from search-result summaries of ZipRecruiter, Glassdoor, Payscale, Talentosy and others, so check any figure you rely on heavily against its source.

### 6.3 Results
| Flag | BDR (92) | WPC (12) |
|---|---|---|
| Within budget | 3 (all Canada) | 0 |
| Borderline | 43 | 2 |
| Over budget | 40 | 4 |
| Over budget - Executive | 6 | 6 |

- **Executive-level, BDR:** Matimba Masinga, Marcia Stuhler, Todd Gillen, Emily Vinyard, Kimberly Millis, Brandon NeSmith
- **Executive-level, WPC:** Mario Azuela, Mark Nakamichi, Darren Gonzalez Avelar, Andrea Rojas, Adrian Olaya

### 6.4 Key findings
1. **The $20/hr BDR budget is below the average US SDR base pay in every state except Florida (about even).** The US average is about $55k. Expect pushback from anyone beyond entry level.
2. **The WPC job description's posted pay is lower than the WPC budget used for the flags.** The job description says **$212/week plus $0.50 per approved hour**, which is about **$5.80/hr, or about $12k/yr**, compared with the $10/hr used. At the posted pay, every WPC strong fit is over budget. **This needs a decision** (see section 7).
3. **The WPC "CSM" role is really telesales.** Mexican sales pay (about MXN 12k/month) is a better comparison than CSM pay (about MXN 38k/month in CDMX). The posted pay is reasonable for entry-level reps, but not for the senior account managers and directors who rank as strong fits.

---

## 7. Open items and next steps (in priority order)

| # | Item | Owner | How |
|---|---|---|---|
| 1 | **Decide the WPC budget:** the posted job pay (about $5.80/hr) or $10/hr | Hiring manager | Then re-flag the 12 WPC strong fits in Airtable |
| 2 | **Replace `AIRTABLE_TOKEN`** with the new owner's token | New owner | Section 4.4, then redeploy |
| 3 | **Confirm deep review works** on the live app | New owner | Click a candidate → Deep review |
| 4 | **Fill in `Location (State)`** and re-price by state | Claude session | See "Claude Code environment" below |
| 5 | **Approve Claude's GitHub access** to the repo | scale-ops org owner | Pending request: org settings → GitHub Apps → Claude → add `ubiquitous-system` |
| 6 | Check BDR flags against the BDR job description's posted pay, if it lists one | New owner | Same idea as finding 2 |
| 7 | *(Cosmetic)* The job summary panel shows raw `#`/`##` markdown symbols | Developer | Render the summary as markdown in `app/page.tsx` |
| 8 | *(Docs)* `resume-screening-app/README.md` doesn't mention setting Vercel's Root Directory, and still describes a direct Anthropic key | Developer | Update when convenient |

### Claude Code environment (if you use Claude to keep working on this)
- **Resumes:** Claude's cloud environment blocks `v5.airtableusercontent.com`, where Airtable stores resume files. Add it under **environment menu → Edit → Network access → Allowed domains**, then start a **new** session.
- **GitHub pushes:** Claude can't push to the repo until item 5 is approved and you reconnect GitHub at https://claude.ai/customize/connectors?auth_start=github&auth_start_force=1. Until then, upload files through GitHub's website.
- **Prompt to continue the Airtable work:**
  > Continue the rate-vs-budget work on Airtable base appqmAg1Av6yheTUu: read each strong-fit resume, fill in Location (State), and re-price using the state rates in pay-rate-benchmarks.md.

---

## 8. Troubleshooting

| You see | Fix |
|---|---|
| Login box keeps reappearing | Wrong password. Check `APP_PASSWORD` in Vercel |
| "Set the APP_PASSWORD environment variable…" | Add `APP_PASSWORD`, then redeploy |
| "Could not resolve authentication method…" | The Gateway variables are missing or misspelled, or you didn't redeploy after adding them |
| "Missing environment variable …" | Add it in Vercel, then redeploy |
| "Airtable error 401/403" | The token is wrong, expired, or lacks access to the base |
| "Airtable error 404" | A table was renamed. The app needs `Job Description Links`, `BDR` and `WPC` |
| "model not found" | Check the exact name under Vercel → AI Gateway → Models and update `CLAUDE_MODEL` |
| Build fails: "No Next.js version detected" | Vercel Root Directory isn't `resume-screening-app` |
| Some rows say "Not scored" | Click **Re-run screening** |
| A job doesn't appear in the list | Its `Job Description Links` row has no PDF attached |

---

## 9. Lessons learned

- **Redeploy after every environment variable change.** Vercel doesn't apply new variables to a running deployment.
- **GitHub Enterprise app approvals happen per repository.** An app installed on the org isn't automatically allowed on every repo, so an org owner has to approve each one.
- **Airtable attachment links expire.** Never store them; fetch fresh links each time, which the app already does.
- **Job titles alone tell you seniority, but not dates.** Someone who was a "Director" 8 years ago is flagged the same as a current one, so spot-check the executive flags.
- **Check each job description's posted pay against the budget** before flagging candidates.
