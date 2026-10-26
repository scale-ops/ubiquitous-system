"use client";

import { useEffect, useState } from "react";
import { RampFields, api, formFromRamp, formToBody, statusClass, type Job, type Manager, type Ramp } from "./shared";

export default function Ramps() {
  const [ramps, setRamps] = useState<Ramp[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(formFromRamp());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ ramps: Ramp[]; managers: Manager[]; jobs: Job[] }>("/api/ramps")
      .then((d) => {
        setRamps(d.ramps);
        setManagers(d.managers);
        setJobs(d.jobs);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const { ramp } = await api<{ ramp: Ramp }>("/api/ramps", "POST", formToBody(form));
      window.location.href = `/ramps/${ramp.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  const nameOf = new Map(managers.map((m) => [m.id, m.name || m.email]));
  const jobOf = new Map(jobs.map((j) => [j.id, j.name]));

  return (
    <main>
      <h1>Hiring ramps</h1>
      <p className="muted">
        Name a ramp, pick who interviews, and the hub reads their calendars for open interview spots.
      </p>
      {error && <p className="error">{error}</p>}

      {!creating ? (
        <button className="primary" onClick={() => setCreating(true)} disabled={loading}>
          + New ramp
        </button>
      ) : (
        <div className="card">
          <h3>New ramp</h3>
          <RampFields form={form} setForm={setForm} managers={managers} jobs={jobs} />
          <div className="actions">
            <button className="primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save and see open spots"}
            </button>
            <button onClick={() => setCreating(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : ramps.length === 0 ? (
          <p className="muted">No ramps yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Ramp</th>
                <th>Status</th>
                <th>Job</th>
                <th>Interviewers</th>
                <th>Days</th>
              </tr>
            </thead>
            <tbody>
              {ramps.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => (window.location.href = `/ramps/${r.id}`)}>
                  <td>
                    <a href={`/ramps/${r.id}`}>{r.name}</a>
                  </td>
                  <td>
                    <span className={`badge ${statusClass(r.status)}`}>{r.status}</span>
                  </td>
                  <td>{(r.jobId && jobOf.get(r.jobId)) || "—"}</td>
                  <td>{r.interviewerIds.map((id) => nameOf.get(id) ?? "(not active)").join(", ") || "—"}</td>
                  <td>{r.startDate || r.endDate ? `${r.startDate || "tomorrow"} → ${r.endDate || "+14 days"}` : "default"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
