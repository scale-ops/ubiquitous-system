"use client";

import { use, useCallback, useEffect, useState } from "react";
import { RampFields, api, formFromRamp, formToBody, statusClass, type Job, type Manager, type Ramp } from "../shared";

type Availability = {
  testMode: boolean;
  timeZone: string;
  hours: string;
  window: { from: string; to: string };
  interviewers: { id: string; name: string; email: string; canSee: boolean; problem: string | null }[];
  days: { day: string; times: number; first: string; last: string; perInterviewer: Record<string, number> }[];
};

function time(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export default function RampPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [ramp, setRamp] = useState<Ramp | null>(null);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [avail, setAvail] = useState<Availability | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(formFromRamp());
  const [busy, setBusy] = useState(false);

  const loadAvailability = useCallback(() => {
    setAvail(null);
    api<Availability>(`/api/ramps/${id}/availability`)
      .then(setAvail)
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    Promise.all([api<{ ramp: Ramp }>(`/api/ramps/${id}`), api<{ managers: Manager[]; jobs: Job[] }>("/api/ramps")])
      .then(([r, list]) => {
        setRamp(r.ramp);
        setManagers(list.managers);
        setJobs(list.jobs);
      })
      .catch((e) => setError(e.message));
    loadAvailability();
  }, [id, loadAvailability]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const { ramp: updated } = await api<{ ramp: Ramp }>(`/api/ramps/${id}`, "PATCH", formToBody(form));
      setRamp(updated);
      setEditing(false);
      loadAvailability();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!ramp) {
    return (
      <main>
        <p>
          <a href="/ramps">← All ramps</a>
        </p>
        {error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}
      </main>
    );
  }

  const totalTimes = avail?.days.reduce((n, d) => n + d.times, 0) ?? 0;
  const hidden = avail?.interviewers.filter((i) => !i.canSee) ?? [];

  return (
    <main>
      <p>
        <a href="/ramps">← All ramps</a>
      </p>
      <h1>{ramp.name}</h1>
      <p>
        <span className={`badge ${statusClass(ramp.status)}`}>{ramp.status}</span>{" "}
        <span className="muted small">{ramp.createdBy && `Set up by ${ramp.createdBy}`}</span>
      </p>
      {error && <p className="error">{error}</p>}

      {editing ? (
        <div className="card">
          <RampFields form={form} setForm={setForm} managers={managers} jobs={jobs} />
          <div className="actions">
            <button className="primary" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </button>
            <button onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="actions">
          <button
            onClick={() => {
              setForm(formFromRamp(ramp));
              setEditing(true);
            }}
          >
            Edit ramp or interviewers
          </button>
          <button onClick={loadAvailability}>Refresh open spots</button>
        </div>
      )}

      <div className="card">
        <h3>Open interview spots</h3>
        {!avail ? (
          <p className="muted">Reading calendars…</p>
        ) : (
          <>
            {avail.testMode && <p className="error">Test mode: these are fake calendars, not real Google data.</p>}
            <p className="muted small">
              {dayLabel(avail.window.from)} → {dayLabel(avail.window.to)}, {avail.hours} ({avail.timeZone}). Candidates see
              these times in their own time zone. 30-minute interviews, with a 15-minute gap around each person&apos;s
              meetings.
            </p>
            {ramp.interviewerIds.length === 0 ? (
              <p>No interviewers picked yet. Click &ldquo;Edit ramp or interviewers&rdquo; to add them.</p>
            ) : (
              <>
                <p>
                  <strong>{totalTimes}</strong> interview times open across <strong>{avail.days.length}</strong> days.
                  If several interviewers are free at the same time, several candidates can book it.
                </p>
                {hidden.length > 0 && (
                  <div className="error">
                    Not counted, because the hub can&apos;t see their calendar:
                    <ul>
                      {hidden.map((h) => (
                        <li key={h.email || h.name}>
                          {h.name || h.email}: {h.problem}
                        </li>
                      ))}
                    </ul>
                    They need to share their free/busy with the team mailbox once.
                  </div>
                )}
                <table>
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th>Times open</th>
                      <th>Start times (first – last)</th>
                      <th>Free interviewers (times each)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {avail.days.map((d) => (
                      <tr key={d.day}>
                        <td>{dayLabel(d.day)}</td>
                        <td>{d.times}</td>
                        <td>
                          {time(d.first, avail.timeZone)} – {time(d.last, avail.timeZone)}
                        </td>
                        <td className="small">
                          {Object.entries(d.perInterviewer)
                            .map(([name, n]) => `${name} (${n})`)
                            .join(", ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
