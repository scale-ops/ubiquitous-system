# ubiquitous-system
Contractor Ops Resume Screening Tool

A private website where you pick a job description and a candidate pool from Airtable, and Claude ranks every candidate by how well they fit.

## How it works

1. **Pick a job.** The list comes from the **Job Description Links** table in Airtable (the PDF in *JD Attachment*).
2. **Pick a candidate pool.** Either **BDR** or **WPC**, one Airtable table each.
3. **Click "Find best fits".** Claude reads the job description, then scores every candidate from 0 to 100 (*Strong / Possible / Weak fit*) with a one-line reason, strengths, and gaps.
4. **Click any candidate** to see details, open their resume, or run a **Deep review with full resume**. For that, Claude reads the resume PDF and writes a requirement checklist plus suggested interview questions.
5. **Download CSV** to share the ranked list.

Airtable is only read, never changed. Results are saved in your browser, so a refresh doesn't lose them.

---

## One-time setup (about 20 minutes)

You'll collect **three keys**, then paste them into Vercel. Keep a notes file open to hold them while you work.

### Step 1: Get an Airtable token

1. Go to <https://airtable.com/create/tokens> and click **Create token**.
2. Name: `Resume Screening`.
3. Under **Scopes**, click **Add a scope** and add `data.records:read`.
4. Under **Access**, click **Add a base** and choose your recruiting base.
5. Click **Create token**, then **copy the token** (it starts with `pat`). Airtable shows it only once.
6. Save it in your notes as `AIRTABLE_TOKEN`.

### Step 2: Get a Claude API key

1. Go to <https://console.anthropic.com> and sign in (or sign up).
2. Go to **Settings → Billing** and add a payment method or credits.
3. Go to **Settings → API Keys**, click **Create Key**, and name it `Resume Screening`.
4. **Copy the key** (it starts with `sk-ant-`). Save it in your notes as `ANTHROPIC_API_KEY`.

### Step 3: Choose a password

Choose a password for your team to use to open the app. Save it in your notes as `APP_PASSWORD`.

### Step 4: Put the app on Vercel

1. Go to <https://vercel.com/new>.
2. Under **Import Git Repository**, find **ubiquitous-system** and click **Import**.
   *If you don't see it, click "Adjust GitHub App Permissions" and give Vercel access to the repo.*
3. Leave **Framework Preset** as **Next.js**.
4. Open **Environment Variables** and add these four, one at a time (Name on the left, Value on the right):

   | Name | Value |
   |---|---|
   | `AIRTABLE_TOKEN` | your `pat…` token from Step 1 |
   | `AIRTABLE_BASE_ID` | `appqmAg1Av6yheTUu` |
   | `ANTHROPIC_API_KEY` | your `sk-ant-…` key from Step 2 |
   | `APP_PASSWORD` | your password from Step 3 |

5. Click **Deploy** and wait about a minute.
6. Click **Visit** (or the `something.vercel.app` link).
7. The browser shows a login box. Type any username and the password from Step 3.

You're done. Bookmark that link.

> **Important:** If the code is on a branch that isn't `main` yet, merge it into `main` first (on GitHub: **Pull requests → New pull request**, pick this branch, then **Merge**). Vercel publishes the `main` branch as your live site.

---

## Daily use

1. Open your bookmarked link and log in.
2. Choose the **Job** and **Candidate pool**.
3. Click **Find best fits**. A full pool of about 340 people takes a few minutes, and the progress bar shows how far along it is.
4. Use the **Strong fit / Possible fit / Weak fit** buttons and the search box to narrow the list.
5. Click a candidate, then **Deep review with full resume** for anyone you're serious about.

### Adding a new job

In Airtable, add a row to **Job Description Links**: type the job name and attach the job description PDF. Refresh the app and it appears in the list.

### Adding new candidates

Add rows to the **BDR** or **WPC** tables as usual, then click **Re-run screening**.

---

## Troubleshooting

| You see | Fix |
|---|---|
| "Missing environment variable …" | In Vercel, go to **Project → Settings → Environment Variables**, add the missing one, then **Deployments → ⋯ → Redeploy**. |
| "Airtable error 401" or "403" | The Airtable token is wrong, or wasn't given access to this base (redo Step 1). |
| "Airtable error 404" | A table name was changed in Airtable. The app expects tables named `Job Description Links`, `BDR`, and `WPC`. |
| An "authentication_error" mentioning the API key | The Claude key is wrong or has been deleted. Redo Step 2. |
| "credit balance is too low" | Add credits in the Claude Console under **Billing**. |
| Some rows say "Not scored" | Click **Re-run screening**. |

## Costs

- **Vercel and GitHub:** the free plans are enough.
- **Claude:** you pay per use. Scoring a full pool of about 340 candidates is roughly a dollar or two, and a deep review is a few cents each. Check the exact amount under **Usage** in the Claude Console after your first run.

---

## For developers

- Next.js (App Router) + TypeScript. Claude calls live in `lib/claude.ts` and Airtable reads live in `lib/airtable.ts`.
- `proxy.ts` password-protects every page and API route with HTTP Basic auth.
- Scoring runs in batches of 20 candidates (`app/page.tsx`), 3 at a time, so no request hits Vercel's time limit.
- Run it locally: `cp .env.example .env.local`, fill it in, then `npm install && npm run dev`.
- To add a new candidate pool (a new Airtable table with the same columns), add its table name to `POOLS` in `lib/airtable.ts` and in `app/page.tsx`.
