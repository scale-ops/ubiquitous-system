"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { SelectCb } from "@/app/api/selectcbs/route";
import { PersonRow } from "./row";

const DOMAINS = ["Architecture & Interior Design", "Graphic Design", "Video Production", "3D Modeling & CAD", "Animation & Motion", "Game Development"];
const STATUSES = ["Shortlist", "Backup", "Not eligible", "Not a fit", "Can't assess", "All"] as const;
const ORDER = ["Shortlist", "Backup", "Reactivation needed", "Not eligible", "Not a fit", "Can't assess"];

function downloadCsv(rows: SelectCb[], fileName: string) {
  const header = ["Status", "Domain", "Rank", "Name", "Email", "Verdict", "Score", "Why they're a fit", "Concerns / gaps", "Background", "Main field", "Tier", "Team"];
  const lines = rows.map((p) => [p.status, p.domain, p.rank ?? "", p.name, p.email, p.verdict, p.score ?? "",
    p.why.join("; "), p.concerns.join("; "), p.profile, p.mainField, p.tier, p.team]);
  const csv = [header, ...lines].map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = fileName;
  link.click();
}

export default function SelectCbs() {
  const [all, setAll] = useState<SelectCb[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [domain, setDomain] = useState("All");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("Shortlist");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/selectcbs")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
        setAll(data.people);
      })
      .catch((e) => setError(`Could not load Select CBs from Airtable: ${e.message}`))
      .finally(() => setLoading(false));
  }, []);

  const inDomain = useMemo(() => all.filter((p) => domain === "All" || p.domain === domain), [all, domain]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: inDomain.length };
    for (const p of inDomain) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [inDomain]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inDomain
      .filter((p) => status === "All" || p.status === status)
      .filter((p) => !q || [p.name, p.email, p.profile, p.mainField, ...p.concerns].join(" ").toLowerCase().includes(q))
      .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.domain.localeCompare(b.domain) ||
        (a.rank ?? 9999) - (b.rank ?? 9999) || (b.score ?? 0) - (a.score ?? 0) || a.name.localeCompare(b.name));
  }, [inDomain, status, search]);

  return (
    <main>
      <p className="small"><a href="/">← Back to resume screening</a> · <a href="/mediagen">MediaGen rankings</a></p>
      <h1>Select CBs</h1>
      <p className="muted">
        Every Select CB, judged from their resume for the six MediaGen media domains. Click anyone to see why they are or aren&apos;t a fit.
      </p>

      <section className="card controls">
        <label>
          Domain
          <select value={domain} onChange={(e) => setDomain(e.target.value)}>
            <option value="All">All domains</option>
            {DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label>
          Search
          <input placeholder="Name, email, background…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </section>

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading Select CBs from Airtable…</p>}

      {!loading && !error && (
        <section className="card">
          <div className="toolbar">
            <div className="chips">
              {STATUSES.map((s) => (
                <button key={s} className={status === s ? "chip active" : "chip"} onClick={() => setStatus(s)}>
                  {s} ({counts[s] ?? 0})
                </button>
              ))}
            </div>
            <button onClick={() => downloadCsv(rows, `Select CBs - ${domain} - ${status}.csv`)}>Download CSV</button>
          </div>
          <table>
            <thead>
              <tr><th>#</th><th>Candidate</th><th>Score</th><th>Why</th></tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <Fragment key={p.id}>
                  <PersonRow p={p} open={openId === p.id} onToggle={() => setOpenId(openId === p.id ? null : p.id)} />
                </Fragment>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="muted">No one matches these filters.</p>}
        </section>
      )}
    </main>
  );
}
