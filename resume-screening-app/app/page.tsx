"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// The screener: pick a ramp, narrow the Candidate Pool, score with Claude, send pre-interviews,
// then review answers and invite or decline. Every decision is a person's; Claude only ranks.

type Ramp = {
  id: string;
  name: string;
  jobId: string | null;
  status: "Planning" | "Open" | "Closed";
  jobTitle: string;
  applicationDeadline: string;
  interviewerIds: string[];
};
type Result = { score: number; verdict: string; summary: string; strengths: string[]; gaps: string[]; deepReview?: string };
type Found = {
  id: string;
  workerId: string;
  name: string;
  email: string;
  country: string;
  team: string;
  jobTitle: string;
  lastActive: string;
  qms: number | null;
  qc: number | null;
  hasResume: boolean;
  result: Result | null;
};
type Check = { label: string; result: "pass" | "fail" | "warn"; detail: string };
type Row = {
  journey: {
    id: string;
    status: string;
    candidateName: string;
    candidateEmail: string;
    workerId: string;
    start: string;
    meetLink: string;
    preInterviewSentAt: string;
  };
  submission: Record<string, unknown> | null;
  checks: Check[];
  submissions: number;
  ipCountry: string;
  score: { score: number; verdict: string; summary: string; deepReview: string } | null;
};
type Preview = { problems: string[]; preview: { to: string; subject: string; text: string } | null; willSend: number; skipped: number; sent: number };

const COUNTRIES = ["US", "CA", "MX", "CO", "AR", "BR", "CL", "PE", "VE", "PH", "IN", "NG", "KE", "ZA", "GB", "ES"];
const PARALLEL = 3;

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

function badge(verdict: string | undefined) {
  return verdict === "Strong fit" ? "good" : verdict === "Possible fit" ? "ok" : "low";
}

function statusBadge(status: string) {
  if (["Scheduled", "Completed", "Invite sent"].includes(status)) return "good";
  if (["Not selected", "Cancelled", "No-show", "Link expired"].includes(status)) return "low";
  return "ok";
}

function when(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

type SortKey = "fit" | "name" | "active" | "qms" | "qc";

function score2(n: number | null): string {
  return n == null ? "—" : n.toFixed(2);
}

function daysAgo(iso: string): string {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return d <= 0 ? "today" : `${d}d ago`;
}

export default function Screener() {
  const [ramps, setRamps] = useState<Ramp[]>([]);
  const [rampId, setRampId] = useState("");
  const [tab, setTab] = useState<"find" | "pipeline">("find");
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ ramps: Ramp[] }>("/api/ramps")
      .then((d) => {
        setRamps(d.ramps);
        const saved = typeof window !== "undefined" ? window.localStorage.getItem("screener.ramp") : null;
        const first = d.ramps.find((r) => r.id === saved) ?? d.ramps.find((r) => r.status !== "Closed") ?? d.ramps[0];
        if (first) setRampId(first.id);
      })
      .catch((e) => setError(e.message));
  }, []);

  const ramp = ramps.find((r) => r.id === rampId) ?? null;

  return (
    <main>
      <h1>Screening</h1>
      <p className="muted">Pick a ramp, narrow the candidate pool, let Claude rank them, then move people through the pipeline.</p>
      {error && <p className="error">{error}</p>}
      <div className="card controls">
        <label>
          Ramp
          <select
            value={rampId}
            onChange={(e) => {
              setRampId(e.target.value);
              try {
                window.localStorage.setItem("screener.ramp", e.target.value);
              } catch {}
            }}
          >
            {ramps.length === 0 && <option value="">No ramps yet</option>}
            {ramps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.status})
              </option>
            ))}
          </select>
        </label>
        {ramp && (
          <div className="small muted rampinfo">
            <div>
              Job title: <strong>{ramp.jobTitle || "not set"}</strong> · Deadline:{" "}
              <strong>{ramp.applicationDeadline || "not set"}</strong> · Interviewers: <strong>{ramp.interviewerIds.length}</strong>
            </div>
            <a href={`/ramps/${ramp.id}`}>Edit ramp →</a>
          </div>
        )}
      </div>
      {ramp && (
        <>
          <div className="chips tabs">
            <button className={`chip ${tab === "find" ? "active" : ""}`} onClick={() => setTab("find")}>
              Find &amp; score
            </button>
            <button className={`chip ${tab === "pipeline" ? "active" : ""}`} onClick={() => setTab("pipeline")}>
              Pipeline
            </button>
          </div>
          {tab === "find" ? <FindAndScore key={ramp.id} ramp={ramp} onSent={() => setTab("pipeline")} /> : <Pipeline key={ramp.id} ramp={ramp} />}
        </>
      )}
    </main>
  );
}

// ---------------- Find & score ----------------

function FindAndScore({ ramp, onSent }: { ramp: Ramp; onSent: () => void }) {
  const [countries, setCountries] = useState<string[]>([]);
  const [otherCountries, setOtherCountries] = useState("");
  const [activeDays, setActiveDays] = useState("30");
  const [hasResume, setHasResume] = useState(true);
  const [minQms, setMinQms] = useState("");
  const [minQc, setMinQc] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [verdict, setVerdict] = useState("All");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "fit", dir: -1 });
  const [showMinQms, setShowMinQms] = useState("");
  const [showMinQc, setShowMinQc] = useState("");
  const [diving, setDiving] = useState<Set<string>>(new Set());
  const summaryRef = useRef<{ jobId: string; summary: string } | null>(null);

  const allCountries = useMemo(
    () => [...countries, ...otherCountries.split(/[,\s]+/).map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c))],
    [countries, otherCountries],
  );

  const search = useCallback(async (keepSelection = false) => {
    setBusy("Finding candidates…");
    setError("");
    try {
      const body = {
        rampId: ramp.id,
        countries: allCountries,
        activeDays: activeDays ? Number(activeDays) : null,
        hasResume,
        minQms: minQms === "" ? null : Number(minQms),
        minQc: minQc === "" ? null : Number(minQc),
      };
      // One automatic retry if the connection hiccups ("Failed to fetch").
      const d = await api<{ candidates: Found[]; more: boolean }>("/api/screen/search", body).catch(async (e) => {
        if (!(e instanceof TypeError)) throw e;
        await new Promise((r) => setTimeout(r, 2000));
        return api<{ candidates: Found[]; more: boolean }>("/api/screen/search", body);
      });
      setFound(d.candidates);
      setMore(d.more);
      if (!keepSelection) setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }, [ramp.id, allCountries, activeDays, hasResume, minQms, minQc]);

  // The job summary is the same for every call, so fetch it once per job.
  async function jobSummary(): Promise<string> {
    if (summaryRef.current?.jobId === ramp.jobId) return summaryRef.current.summary;
    const { summary } = await api<{ summary: string }>("/api/job-summary", { jobId: ramp.jobId });
    summaryRef.current = { jobId: ramp.jobId!, summary };
    return summary;
  }

  // Deep dive: Claude reads each candidate's full résumé and the job description.
  async function deepDive(ids: string[]) {
    if (!ramp.jobId || !ids.length) return;
    setError("");
    setDiving((d) => new Set([...d, ...ids]));
    try {
      const summary = await jobSummary();
      const queue = [...ids];
      const failed: string[] = [];
      const worker = async () => {
        while (queue.length) {
          const id = queue.shift()!;
          try {
            const { result } = await api<{ result: Result }>("/api/screen/deep-dive", { rampId: ramp.id, jobSummary: summary, candidateId: id });
            setFound((f) => f?.map((c) => (c.id === id ? { ...c, result } : c)) ?? f);
          } catch (e) {
            failed.push(`${found?.find((c) => c.id === id)?.name ?? id}: ${e instanceof Error ? e.message : String(e)}`);
          } finally {
            setDiving((d) => {
              const n = new Set(d);
              n.delete(id);
              return n;
            });
          }
        }
      };
      await Promise.all(Array.from({ length: PARALLEL }, worker));
      if (failed.length) setError(`Deep dive failed for ${failed.join("; ")}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDiving(new Set());
    }
  }

  async function scoreAll() {
    if (!found || !ramp.jobId) return;
    const todo = found.filter((c) => !c.result && (selected.size === 0 || selected.has(c.id)));
    if (!todo.length) return;
    setBusy("Reading the job description…");
    setError("");
    try {
      const summary = await jobSummary();
      const batches: string[][] = [];
      for (let i = 0; i < todo.length; i += 20) batches.push(todo.slice(i, i + 20).map((c) => c.id));
      setProgress({ done: 0, total: todo.length });
      setBusy("Scoring with Claude…");
      let next = 0;
      const worker = async () => {
        while (next < batches.length) {
          const batch = batches[next++];
          await api("/api/screen/score", { rampId: ramp.id, jobSummary: summary, candidateIds: batch });
          setProgress((p) => (p ? { ...p, done: Math.min(p.total, p.done + batch.length) } : p));
        }
      };
      await Promise.all(Array.from({ length: PARALLEL }, worker));
      await search(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
      setProgress(null);
    }
  }

  async function previewSend() {
    setError("");
    setBusy("Preparing the email…");
    try {
      setPreview(await api<Preview>("/api/screen/pre-interview", { rampId: ramp.id, candidateIds: [...selected], dryRun: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function send() {
    setBusy("Sending…");
    setError("");
    try {
      const r = await api<Preview>("/api/screen/pre-interview", { rampId: ramp.id, candidateIds: [...selected], dryRun: false });
      setPreview(null);
      if (r.problems.length) setError(r.problems.join(" "));
      if (r.sent) {
        alert(`Sent ${r.sent} pre-interview email${r.sent === 1 ? "" : "s"}.`);
        onSent();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  const rows = useMemo(() => {
    const qmsMin = showMinQms === "" ? null : Number(showMinQms);
    const qcMin = showMinQc === "" ? null : Number(showMinQc);
    const list = (found ?? [])
      .filter((c) => verdict === "All" || (verdict === "Not scored" ? !c.result : c.result?.verdict === verdict))
      .filter((c) => qmsMin == null || (c.qms ?? -1) >= qmsMin)
      .filter((c) => qcMin == null || (c.qc ?? -1) >= qcMin);
    const value = (c: Found): number | string => {
      if (sort.key === "fit") return c.result?.score ?? -1;
      if (sort.key === "qms") return c.qms ?? -1;
      if (sort.key === "qc") return c.qc ?? -1;
      if (sort.key === "active") return Date.parse(c.lastActive) || 0;
      return c.name.toLowerCase();
    };
    return list.sort((a, b) => {
      const x = value(a);
      const y = value(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [found, verdict, sort, showMinQms, showMinQc]);
  const unscored = found?.filter((c) => !c.result).length ?? 0;
  const tickedUnscored = found?.filter((c) => !c.result && selected.has(c.id)).length ?? 0;
  const scoreLabel =
    selected.size > 0
      ? tickedUnscored > 0
        ? `Score ${tickedUnscored} ticked with Claude`
        : "Ticked candidates are already scored"
      : unscored > 0
        ? `Score all ${unscored} unscored with Claude`
        : "All candidates scored ✓";
  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "name" ? 1 : -1 }));
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : "");

  return (
    <>
      <div className="card">
        <h3>Narrow the pool</h3>
        <div className="pickers">
          {COUNTRIES.map((c) => (
            <label key={c} className="pick">
              <input
                type="checkbox"
                checked={countries.includes(c)}
                onChange={() => setCountries(countries.includes(c) ? countries.filter((x) => x !== c) : [...countries, c])}
              />
              <span>{c}</span>
            </label>
          ))}
        </div>
        <div className="controls">
          <label>
            Other country codes
            <input value={otherCountries} onChange={(e) => setOtherCountries(e.target.value)} placeholder="e.g. PE, GT" />
          </label>
          <label>
            Active in the last
            <select value={activeDays} onChange={(e) => setActiveDays(e.target.value)}>
              <option value="">any time</option>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
            </select>
          </label>
          <label>
            Min QMS score
            <input type="number" step="0.1" min={1} max={5} value={minQms} onChange={(e) => setMinQms(e.target.value)} placeholder="any" />
          </label>
          <label>
            Min QC score
            <input type="number" step="0.1" min={1} max={5} value={minQc} onChange={(e) => setMinQc(e.target.value)} placeholder="any" />
          </label>
          <label className="pick">
            <input type="checkbox" checked={hasResume} onChange={(e) => setHasResume(e.target.checked)} />
            <span>Has a résumé</span>
          </label>
          <button className="primary" onClick={() => search()} disabled={Boolean(busy)}>
            Find candidates
          </button>
        </div>
        <p className="muted small">No country ticked means all countries. Up to 300 candidates are shown, most recently active first.</p>
      </div>

      {busy && (
        <div className="card">
          <p>{busy}</p>
          {progress && <progress value={progress.done} max={progress.total} />}
        </div>
      )}
      {error && <p className="error">{error}</p>}

      {found && (
        <div className="card">
          <div className="toolbar">
            <strong>
              {found.length}
              {more ? "+" : ""} candidates
            </strong>
            {more && <span className="muted small">Showing the 300 most recently active. Narrow the filters to see others.</span>}
            <div className="chips small">
              {["All", "Strong fit", "Possible fit", "Weak fit", "Not scored"].map((v) => (
                <button key={v} className={`chip ${verdict === v ? "active" : ""}`} onClick={() => setVerdict(v)}>
                  {v}
                </button>
              ))}
            </div>
            <label className="inline">
              QMS ≥
              <input type="number" step="0.1" value={showMinQms} onChange={(e) => setShowMinQms(e.target.value)} placeholder="any" />
            </label>
            <label className="inline">
              QC ≥
              <input type="number" step="0.1" value={showMinQc} onChange={(e) => setShowMinQc(e.target.value)} placeholder="any" />
            </label>
            <span className="muted small">{rows.length} shown</span>
          </div>
          <div className="actions">
            <button onClick={scoreAll} disabled={Boolean(busy) || !ramp.jobId || (selected.size > 0 ? !tickedUnscored : !unscored)}>
              {scoreLabel}
            </button>
            <button onClick={() => deepDive([...selected])} disabled={Boolean(busy) || !ramp.jobId || !selected.size || diving.size > 0}>
              {diving.size > 0 ? `Deep diving… ${diving.size} left` : `Deep dive ticked (${selected.size})`}
            </button>
            <button className="primary" onClick={previewSend} disabled={Boolean(busy) || !selected.size}>
              Send pre-interview ({selected.size})
            </button>
            {!ramp.jobId && <span className="muted small">Link a job (with its PDF) to the ramp to score.</span>}
          </div>
          <table className="found">
            <thead>
              <tr>
                <th className="pickcol">
                  <input
                    type="checkbox"
                    aria-label="Select all shown"
                    checked={rows.length > 0 && rows.every((r) => selected.has(r.id))}
                    onChange={(e) => setSelected(e.target.checked ? new Set(rows.slice(0, 50).map((r) => r.id)) : new Set())}
                  />
                </th>
                <th><button className="sort" onClick={() => sortBy("name")}>Candidate{arrow("name")}</button></th>
                <th><button className="sort" onClick={() => sortBy("fit")}>Fit{arrow("fit")}</button></th>
                <th>Country</th>
                <th><button className="sort" onClick={() => sortBy("active")}>Active{arrow("active")}</button></th>
                <th><button className="sort" onClick={() => sortBy("qms")}>QMS{arrow("qms")}</button></th>
                <th><button className="sort" onClick={() => sortBy("qc")}>QC{arrow("qc")}</button></th>
                <th>Résumé</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <FoundRow
                  key={c.id}
                  c={c}
                  open={open === c.id}
                  onToggle={() => setOpen(open === c.id ? null : c.id)}
                  checked={selected.has(c.id)}
                  diving={diving.has(c.id)}
                  canDive={Boolean(ramp.jobId)}
                  onDive={() => deepDive([c.id])}
                  onCheck={() => {
                    const s = new Set(selected);
                    if (s.has(c.id)) s.delete(c.id);
                    else if (s.size < 50) s.add(c.id);
                    setSelected(s);
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview && (
        <div className="modal" role="dialog">
          <div className="card">
            <h3>Send pre-interview</h3>
            {preview.problems.length > 0 ? (
              <div className="error">
                {preview.problems.map((p) => (
                  <div key={p}>{p}</div>
                ))}
              </div>
            ) : (
              <p>
                This will email <strong>{preview.willSend}</strong> candidate{preview.willSend === 1 ? "" : "s"} from recruiting@outlier.ai,
                with the job description attached.
                {preview.skipped > 0 && ` ${preview.skipped} skipped (already sent, or no email address).`}
              </p>
            )}
            {preview.preview && (
              <div className="review">
                <div className="small muted">To: {preview.preview.to}</div>
                <div>
                  <strong>{preview.preview.subject}</strong>
                </div>
                <div className="pre">{preview.preview.text}</div>
              </div>
            )}
            <div className="actions">
              <button className="primary" onClick={send} disabled={Boolean(busy) || preview.problems.length > 0 || !preview.willSend}>
                Send to {preview.willSend}
              </button>
              <button onClick={() => setPreview(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function FoundRow(props: {
  c: Found;
  open: boolean;
  onToggle: () => void;
  checked: boolean;
  onCheck: () => void;
  diving: boolean;
  canDive: boolean;
  onDive: () => void;
}) {
  const { c, open, onToggle, checked, onCheck, diving, canDive, onDive } = props;
  return (
    <>
      <tr className="clickable" onClick={onToggle}>
        <td className="pickcol" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={checked} onChange={onCheck} aria-label={`Select ${c.name}`} />
        </td>
        <td>
          <strong>{c.name}</strong>
          <div className="muted small clamp">{c.result?.summary || c.team}</div>
        </td>
        <td>
          {diving ? (
            <span className="muted small">deep diving…</span>
          ) : c.result ? (
            <>
              <span className={`badge ${badge(c.result.verdict)}`}>{c.result.score} · {c.result.verdict}</span>
              {c.result.deepReview && (
                <div>
                  <span className="badge dive">Deep dive ✓</span>
                </div>
              )}
            </>
          ) : (
            <span className="muted small">not scored</span>
          )}
        </td>
        <td>{c.country || "—"}</td>
        <td>{daysAgo(c.lastActive)}</td>
        <td>{score2(c.qms)}</td>
        <td>{score2(c.qc)}</td>
        <td>{c.hasResume ? "✓" : "—"}</td>
      </tr>
      {open && (
        <tr className="details">
          <td colSpan={8}>
            {c.result && (
              <div className="grid">
                <div>
                  <h4>Strengths</h4>
                  <ul>{c.result.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
                </div>
                <div>
                  <h4>Gaps</h4>
                  <ul>{c.result.gaps.map((s) => <li key={s}>{s}</li>)}</ul>
                </div>
              </div>
            )}
            <div className="actions">
              <button onClick={onDive} disabled={diving || !canDive}>
                {diving ? "Reading the résumé…" : c.result?.deepReview ? "Redo deep dive" : "Deep dive with full résumé"}
              </button>
              {!c.hasResume && <span className="muted small">No résumé on file: the deep dive will use the profile only.</span>}
            </div>
            {c.result?.deepReview && <div className="pre review">{c.result.deepReview}</div>}
            <p className="small">
              <strong>Team:</strong> {c.team || "—"}
              <br />
              <strong>Recent titles:</strong> {c.jobTitle || "—"}
              <br />
              <strong>Worker ID:</strong> {c.workerId}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------- Pipeline ----------------

const ANSWER_LABELS: [string, string][] = [
  ["country", "Country"],
  ["otherCountry", "Other country"],
  ["state", "State"],
  ["workAuthorization", "Work authorization"],
  ["english", "English"],
  ["eightHour", "8-hour shifts"],
  ["days", "Days available"],
  ["weeklyHours", "Weekly hours"],
  ["degree", "Highest degree"],
  ["startDate", "Earliest start"],
  ["referredBy", "Referred by"],
  ["linkedin", "LinkedIn"],
];

function Pipeline({ ramp }: { ramp: Ramp }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [status, setStatus] = useState("All");

  const load = useCallback(() => {
    setError("");
    fetch(`/api/screen/pipeline?rampId=${ramp.id}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setRows(d.rows)))
      .catch((e) => setError(String(e)));
  }, [ramp.id]);

  useEffect(load, [load]);

  async function decide(row: Row, decision: "invite" | "not_selected") {
    const label = decision === "invite" ? "send an interview invite to" : "mark as Not selected";
    if (!window.confirm(`${decision === "invite" ? "Send" : "Mark"}: ${label} ${row.journey.candidateName}?`)) return;
    setBusy(row.journey.id);
    setError("");
    try {
      await api("/api/screen/decision", { rampId: ramp.id, interviewId: row.journey.id, decision });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  const statuses = useMemo(() => ["All", ...new Set((rows ?? []).map((r) => r.journey.status))], [rows]);
  const shown = (rows ?? []).filter((r) => status === "All" || r.journey.status === status);

  return (
    <div className="card">
      <div className="toolbar">
        <strong>{rows ? `${rows.length} in the pipeline` : "Loading…"}</strong>
        <div className="chips small">
          {statuses.map((s) => (
            <button key={s} className={`chip ${status === s ? "active" : ""}`} onClick={() => setStatus(s)}>
              {s}
            </button>
          ))}
        </div>
        <button onClick={load}>Refresh</button>
      </div>
      {error && <p className="error">{error}</p>}
      {rows && rows.length === 0 && <p className="muted">Nobody yet. Send pre-interviews from the Find &amp; score tab.</p>}
      {shown.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Status</th>
              <th>Fit</th>
              <th>Checks</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const fails = r.checks.filter((c) => c.result === "fail").length;
              const warns = r.checks.filter((c) => c.result === "warn").length;
              const canDecide = ["Pre-interview received", "Pre-interview sent"].includes(r.journey.status);
              return (
                <PipelineRow
                  key={r.journey.id}
                  r={r}
                  open={open === r.journey.id}
                  onToggle={() => setOpen(open === r.journey.id ? null : r.journey.id)}
                  summary={r.submission ? `${r.checks.length - fails - warns} ✓ · ${fails} ✗ · ${warns} ⚠` : "waiting for answers"}
                  actions={
                    canDecide && (
                      <div className="actions" onClick={(e) => e.stopPropagation()}>
                        <button className="primary" disabled={busy === r.journey.id || !r.submission} onClick={() => decide(r, "invite")}>
                          Invite to interview
                        </button>
                        <button disabled={busy === r.journey.id} onClick={() => decide(r, "not_selected")}>
                          Not selected
                        </button>
                      </div>
                    )
                  }
                />
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PipelineRow({ r, open, onToggle, summary, actions }: { r: Row; open: boolean; onToggle: () => void; summary: string; actions: React.ReactNode }) {
  const s = r.submission;
  return (
    <>
      <tr className="clickable" onClick={onToggle}>
        <td>
          <strong>{r.journey.candidateName}</strong>
          <div className="muted small">{r.journey.candidateEmail}</div>
        </td>
        <td>
          <span className={`badge ${statusBadge(r.journey.status)}`}>{r.journey.status}</span>
          {r.journey.status === "Scheduled" && <div className="small">{when(r.journey.start)}</div>}
        </td>
        <td>
          {r.score ? <span className={`badge ${badge(r.score.verdict)}`}>{r.score.score}</span> : "—"}
          {r.score?.deepReview && (
            <div>
              <span className="badge dive">Deep dive ✓</span>
            </div>
          )}
        </td>
        <td className="small">{summary}</td>
        <td>{actions}</td>
      </tr>
      {open && (
        <tr className="details">
          <td colSpan={5}>
            {r.score && <p className="small">{r.score.summary}</p>}
            {r.score?.deepReview && (
              <details className="small">
                <summary>
                  <strong>Résumé deep dive and interview questions</strong>
                </summary>
                <div className="pre review">{r.score.deepReview}</div>
              </details>
            )}
            {s ? (
              <div className="grid">
                <div>
                  <h4>Pre-interview answers</h4>
                  <ul className="small">
                    {ANSWER_LABELS.map(([key, label]) => {
                      const v = s[key];
                      const shown = Array.isArray(v) ? v.join(", ") : v === null || v === undefined ? "" : String(v);
                      return shown ? (
                        <li key={key}>
                          <strong>{label}:</strong> {shown}
                        </li>
                      ) : null;
                    })}
                    <li>
                      <strong>Government ID:</strong> {s.hasGovernmentId ? "provided ✓" : "not provided"}
                    </li>
                    <li>
                      <strong>Contract duration acknowledged:</strong> {s.ackContract ? "yes" : "no"}
                    </li>
                    <li>
                      <strong>IP country:</strong> {r.ipCountry || "—"}
                    </li>
                  </ul>
                </div>
                <div>
                  <h4>Checks</h4>
                  <ul className="checks">
                    {r.checks.map((c) => (
                      <li key={c.label} className={c.result}>
                        {c.result === "pass" ? "✓" : c.result === "fail" ? "✗" : "⚠"} {c.label}
                        <span className="muted small"> ({c.detail})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="muted small">Pre-interview sent {when(r.journey.preInterviewSentAt)}. No answers yet.</p>
            )}
            {r.journey.meetLink && (
              <p className="small">
                Meet link: <a href={r.journey.meetLink}>{r.journey.meetLink}</a>
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
