"use client";

import { useEffect, useMemo, useState } from "react";
import type { Candidate, Job, Pool } from "@/lib/airtable";
import type { Score } from "@/lib/claude";

const POOLS: Pool[] = ["BDR", "WPC"];
const BATCH_SIZE = 20;
const PARALLEL_BATCHES = 3;

type Row = Candidate & { result?: Score; error?: string };
type Saved = { jobSummary: string; rows: Row[]; ranAt: string };

async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function storageKey(jobId: string, pool: Pool) {
  return `screening:${jobId}:${pool}`;
}

function downloadCsv(rows: Row[], fileName: string) {
  const header = ["Rank", "Name", "Email", "Score", "Verdict", "Summary", "Strengths", "Gaps", "Current titles", "Resume"];
  const lines = rows.map((r, i) => [
    i + 1, r.name, r.email, r.result?.score ?? "", r.result?.verdict ?? "", r.result?.summary ?? "",
    r.result?.strengths.join("; ") ?? "", r.result?.gaps.join("; ") ?? "", r.jobTitle, r.resumeUrl ?? "",
  ]);
  const csv = [header, ...lines]
    .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = fileName;
  link.click();
}

export default function Home() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState("");
  const [pool, setPool] = useState<Pool>("BDR");
  const [jobSummary, setJobSummary] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [ranAt, setRanAt] = useState("");
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"All" | Score["verdict"]>("All");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState<string | null>(null);

  useEffect(() => {
    api<{ jobs: Job[] }>("/api/jobs")
      .then(({ jobs }) => {
        setJobs(jobs);
        if (jobs[0]) setJobId(jobs[0].id);
      })
      .catch((e) => setError(`Could not load jobs from Airtable: ${e.message}`));
  }, []);

  // Show the last saved results for this job + pool, if any.
  useEffect(() => {
    if (!jobId) return;
    const saved = localStorage.getItem(storageKey(jobId, pool));
    const parsed: Saved | null = saved ? JSON.parse(saved) : null;
    setJobSummary(parsed?.jobSummary ?? "");
    setRows(parsed?.rows ?? []);
    setRanAt(parsed?.ranAt ?? "");
    setReviews({});
    setOpenId(null);
  }, [jobId, pool]);

  async function run() {
    setRunning(true);
    setError("");
    setRows([]);
    setReviews({});
    try {
      setStatus("Reading the job description…");
      const { summary } = await api<{ summary: string }>("/api/job-summary", { jobId });
      setJobSummary(summary);

      setStatus(`Loading ${pool} candidates from Airtable…`);
      const { candidates } = await api<{ candidates: Candidate[] }>(`/api/candidates?pool=${pool}`);

      const batches = chunk(candidates, BATCH_SIZE);
      const scored: Row[] = [];
      setProgress({ done: 0, total: candidates.length });
      setStatus("Scoring candidates…");

      let next = 0;
      async function worker() {
        while (next < batches.length) {
          const batch = batches[next++];
          let batchRows: Row[];
          try {
            const { scores } = await api<{ scores: Score[] }>("/api/score", { jobSummary: summary, candidates: batch });
            const byId = new Map(scores.map((s) => [s.id, s]));
            batchRows = batch.map((c) => ({ ...c, result: byId.get(c.id), error: byId.has(c.id) ? undefined : "Not scored" }));
          } catch (e) {
            batchRows = batch.map((c) => ({ ...c, error: (e as Error).message }));
          }
          scored.push(...batchRows);
          setRows([...scored]);
          setProgress((p) => ({ ...p, done: p.done + batch.length }));
        }
      }
      await Promise.all(Array.from({ length: PARALLEL_BATCHES }, worker));

      const now = new Date().toLocaleString();
      setRanAt(now);
      localStorage.setItem(storageKey(jobId, pool), JSON.stringify({ jobSummary: summary, rows: scored, ranAt: now }));
      setStatus("");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setRunning(false);
    }
  }

  async function review(candidateId: string) {
    setReviewing(candidateId);
    try {
      const { review } = await api<{ review: string }>("/api/deep-review", { jobId, jobSummary, pool, candidateId });
      setReviews((r) => ({ ...r, [candidateId]: review }));
    } catch (e) {
      setReviews((r) => ({ ...r, [candidateId]: `Error: ${(e as Error).message}` }));
    } finally {
      setReviewing(null);
    }
  }

  const ranked = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...rows]
      .sort((a, b) => (b.result?.score ?? -1) - (a.result?.score ?? -1))
      .filter((r) => filter === "All" || r.result?.verdict === filter)
      .filter((r) => !q || `${r.name} ${r.email} ${r.jobTitle} ${r.skills}`.toLowerCase().includes(q));
  }, [rows, filter, search]);

  const counts = useMemo(() => {
    const c = { "Strong fit": 0, "Possible fit": 0, "Weak fit": 0 };
    for (const r of rows) if (r.result) c[r.result.verdict]++;
    return c;
  }, [rows]);

  const jobName = jobs.find((j) => j.id === jobId)?.name ?? "";

  return (
    <main>
      <h1>Resume Screening</h1>
      <p className="muted">Pick a job and a candidate pool, then let Claude rank the best fits.</p>

      <section className="card controls">
        <label>
          Job
          <select value={jobId} onChange={(e) => setJobId(e.target.value)} disabled={running}>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.name}</option>
            ))}
          </select>
        </label>
        <label>
          Candidate pool
          <select value={pool} onChange={(e) => setPool(e.target.value as Pool)} disabled={running}>
            {POOLS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <button className="primary" onClick={run} disabled={running || !jobId}>
          {running ? "Working…" : rows.length ? "Re-run screening" : "Find best fits"}
        </button>
      </section>

      {error && <p className="error">{error}</p>}

      {running && (
        <section className="card">
          <p>{status}</p>
          {progress.total > 0 && (
            <>
              <progress value={progress.done} max={progress.total} />
              <p className="muted">{progress.done} of {progress.total} candidates scored</p>
            </>
          )}
        </section>
      )}

      {jobSummary && (
        <details className="card">
          <summary>What Claude is looking for in “{jobName}”</summary>
          <div className="pre">{jobSummary}</div>
        </details>
      )}

      {rows.length > 0 && (
        <section className="card">
          <div className="toolbar">
            <div className="chips">
              {(["All", "Strong fit", "Possible fit", "Weak fit"] as const).map((v) => (
                <button key={v} className={filter === v ? "chip active" : "chip"} onClick={() => setFilter(v)}>
                  {v}{v !== "All" && ` (${counts[v]})`}
                </button>
              ))}
            </div>
            <input placeholder="Search name, title, skills…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <button onClick={() => downloadCsv(ranked, `${jobName} - ${pool}.csv`)}>Download CSV</button>
          </div>
          {ranAt && <p className="muted">Last run {ranAt}</p>}

          <table>
            <thead>
              <tr><th>#</th><th>Candidate</th><th>Score</th><th>Why</th></tr>
            </thead>
            <tbody>
              {ranked.map((r, i) => (
                <FragmentRow
                  key={r.id}
                  rank={i + 1}
                  row={r}
                  open={openId === r.id}
                  onToggle={() => setOpenId(openId === r.id ? null : r.id)}
                  review={reviews[r.id]}
                  reviewing={reviewing === r.id}
                  onReview={() => review(r.id)}
                  pool={pool}
                />
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

function FragmentRow(props: {
  rank: number;
  row: Row;
  open: boolean;
  onToggle: () => void;
  review?: string;
  reviewing: boolean;
  onReview: () => void;
  pool: Pool;
}) {
  const { rank, row, open, onToggle, review, reviewing, onReview, pool } = props;
  const verdict = row.result?.verdict;
  const badge = verdict === "Strong fit" ? "good" : verdict === "Possible fit" ? "ok" : "low";
  return (
    <>
      <tr className="clickable" onClick={onToggle}>
        <td>{rank}</td>
        <td>
          <strong>{row.name}</strong>
          <div className="muted small">{row.jobTitle}</div>
        </td>
        <td>
          {row.result ? (
            <span className={`badge ${badge}`}>{row.result.score} · {verdict}</span>
          ) : (
            <span className="badge low" title={row.error}>Not scored</span>
          )}
        </td>
        <td>{row.result?.summary ?? row.error}</td>
      </tr>
      {open && (
        <tr className="details">
          <td />
          <td colSpan={3}>
            <div className="grid">
              <div>
                <h4>Strengths</h4>
                <ul>{row.result?.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
              </div>
              <div>
                <h4>Gaps</h4>
                <ul>{row.result?.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
              </div>
            </div>
            <p className="small">
              <b>Email:</b> {row.email || "n/a"} · <b>Experience:</b> {row.experience || "n/a"} · <b>Education:</b> {row.education || "n/a"}
            </p>
            <div className="actions">
              {row.resumeUrl && <a href={`/api/resume?pool=${pool}&id=${row.id}`} target="_blank" rel="noreferrer">Open resume</a>}
              <button onClick={onReview} disabled={reviewing}>
                {reviewing ? "Reading resume…" : review ? "Redo deep review" : "Deep review with full resume"}
              </button>
            </div>
            {review && <div className="pre review">{review}</div>}
          </td>
        </tr>
      )}
    </>
  );
}
