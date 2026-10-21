"use client";

import { useEffect, useMemo, useState } from "react";
import type { MediaGenCandidate } from "@/app/api/mediagen/route";
import { DOMAINS, STATUSES, STATUS_ORDER, VERDICTS, downloadCsv } from "./helpers";
import { CandidateRow } from "./row";

export default function MediaGenRankings() {
  const [all, setAll] = useState<MediaGenCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [domain, setDomain] = useState(Object.keys(DOMAINS)[0]);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("Shortlist");
  const [verdict, setVerdict] = useState<(typeof VERDICTS)[number]>("All");
  const [search, setSearch] = useState("");
  const [selectOnly, setSelectOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/mediagen")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
        setAll(data.candidates);
      })
      .catch((e) => setError(`Could not load MediaGen candidates from Airtable: ${e.message}`))
      .finally(() => setLoading(false));
  }, []);

  const inDomain = useMemo(
    () => all.filter((c) => (domain === "All" || c.domain === domain) && (!selectOnly || c.selectCb)),
    [all, domain, selectOnly],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { All: inDomain.length };
    for (const c of inDomain) counts[c.status] = (counts[c.status] ?? 0) + 1;
    return counts;
  }, [inDomain]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inDomain
      .filter((c) => status === "All" || c.status === status)
      .filter((c) => verdict === "All" || c.verdict === verdict)
      .filter((c) => !q || [c.name, c.email, c.profile, c.notes, c.country].join(" ").toLowerCase().includes(q))
      .sort((a, b) =>
        STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
        a.domain.localeCompare(b.domain) ||
        (a.rank ?? 9999) - (b.rank ?? 9999) ||
        (b.score ?? 0) - (a.score ?? 0),
      );
  }, [inDomain, status, verdict, search]);

  return (
    <main>
      <p className="small"><a href="/">← Back to resume screening</a></p>
      <h1>MediaGen QMA rankings</h1>
      <p className="muted">
        Freelancers to train and evaluate AI in six media domains (PKJA RLI MediaGen). Ranked ahead of time from resume reads,
        platform quality, AI-eval history and availability. Click anyone to see why they are or aren&apos;t a fit.
      </p>

      <section className="card controls">
        <label>
          Domain
          <select value={domain} onChange={(e) => setDomain(e.target.value)}>
            {Object.entries(DOMAINS).map(([d, need]) => (
              <option key={d} value={d}>{d} (need {need})</option>
            ))}
            <option value="All">All domains</option>
          </select>
        </label>
        <label>
          Search
          <input placeholder="Name, email, background…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 8 }}>
          <input type="checkbox" style={{ minWidth: 0 }} checked={selectOnly} onChange={(e) => setSelectOnly(e.target.checked)} />
          Select CBs only
        </label>
      </section>

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading candidates from Airtable…</p>}

      {!loading && !error && (
        <section className="card">
          <div className="toolbar">
            <div className="chips">
              {STATUSES.map((s) => (
                <button key={s} className={status === s ? "chip active" : "chip"} onClick={() => setStatus(s)}>
                  {s} ({statusCounts[s] ?? 0})
                </button>
              ))}
            </div>
          </div>
          <div className="toolbar" style={{ marginTop: 10 }}>
            <div className="chips">
              {VERDICTS.map((v) => (
                <button key={v} className={verdict === v ? "chip active" : "chip"} onClick={() => setVerdict(v)}>{v}</button>
              ))}
            </div>
            <button onClick={() => downloadCsv(rows, `MediaGen QMA - ${domain} - ${status}${selectOnly ? " - Select CBs" : ""}.csv`)}>Download CSV</button>
          </div>

          <table>
            <thead>
              <tr><th>#</th><th>Candidate</th><th>Score</th><th>Why</th></tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <CandidateRow key={c.id} c={c} showDomain={domain === "All"} open={openId === c.id} onToggle={() => setOpenId(openId === c.id ? null : c.id)} />
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="muted">No candidates match these filters.</p>}
        </section>
      )}
    </main>
  );
}
