"use client";

// Pieces shared by the Ramps list and the single-ramp page.

export type Manager = { id: string; name: string; email: string };
export type Job = { id: string; name: string };
export type Ramp = {
  id: string;
  name: string;
  jobId: string | null;
  interviewerIds: string[];
  status: "Planning" | "Open" | "Closed";
  startDate: string;
  endDate: string;
  hoursStart: number | null;
  hoursEnd: number | null;
  timeZone: string;
  maxPerDay: number | null;
  createdBy: string;
  notes: string;
  jobTitle: string;
  applicationDeadline: string;
};

export const TIME_ZONES = [
  "America/Chicago",
  "America/New_York",
  "America/Denver",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/Bogota",
  "America/Lima",
  "America/Argentina/Buenos_Aires",
  "America/Sao_Paulo",
  "Europe/London",
  "Asia/Manila",
  "Asia/Kolkata",
];

export async function api<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export function statusClass(status: Ramp["status"]): string {
  return status === "Open" ? "good" : status === "Planning" ? "ok" : "low";
}

// Editable settings: name, job, dates, hours, time zone, daily limit, interviewers.
export type RampForm = {
  name: string;
  jobId: string;
  startDate: string;
  endDate: string;
  hoursStart: string;
  hoursEnd: string;
  timeZone: string;
  maxPerDay: string;
  interviewerIds: string[];
  status: Ramp["status"];
  notes: string;
  jobTitle: string;
  applicationDeadline: string;
};

export function formFromRamp(r?: Ramp): RampForm {
  return {
    name: r?.name ?? "",
    jobId: r?.jobId ?? "",
    startDate: r?.startDate ?? "",
    endDate: r?.endDate ?? "",
    hoursStart: r?.hoursStart?.toString() ?? "",
    hoursEnd: r?.hoursEnd?.toString() ?? "",
    timeZone: r?.timeZone ?? "",
    maxPerDay: r?.maxPerDay?.toString() ?? "",
    interviewerIds: r?.interviewerIds ?? [],
    status: r?.status ?? "Planning",
    notes: r?.notes ?? "",
    jobTitle: r?.jobTitle ?? "",
    applicationDeadline: r?.applicationDeadline ?? "",
  };
}

export function RampFields({
  form,
  setForm,
  managers,
  jobs,
}: {
  form: RampForm;
  setForm: (f: RampForm) => void;
  managers: Manager[];
  jobs: Job[];
}) {
  const set = (key: keyof RampForm) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  const toggle = (id: string) =>
    setForm({
      ...form,
      interviewerIds: form.interviewerIds.includes(id) ? form.interviewerIds.filter((x) => x !== id) : [...form.interviewerIds, id],
    });
  return (
    <div className="rampform">
      <label>
        Ramp name
        <input value={form.name} onChange={set("name")} placeholder="QA Aether Ramp 10.25.2026" />
      </label>
      <div className="controls">
        <label>
          Job title candidates see
          <input value={form.jobTitle} onChange={set("jobTitle")} placeholder="QA Reviewer" />
        </label>
        <label>
          Application deadline
          <input type="date" value={form.applicationDeadline} onChange={set("applicationDeadline")} />
        </label>
      </div>
      <div className="controls">
        <label>
          Job (optional)
          <select value={form.jobId} onChange={set("jobId")}>
            <option value="">—</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={form.status} onChange={set("status")}>
            <option>Planning</option>
            <option>Open</option>
            <option>Closed</option>
          </select>
        </label>
      </div>
      <div className="controls">
        <label>
          First interview day
          <input type="date" value={form.startDate} onChange={set("startDate")} />
        </label>
        <label>
          Last interview day
          <input type="date" value={form.endDate} onChange={set("endDate")} />
        </label>
      </div>
      <div className="controls">
        <label>
          Hours from
          <input type="number" min={0} max={23} value={form.hoursStart} onChange={set("hoursStart")} placeholder="9" />
        </label>
        <label>
          Hours to
          <input type="number" min={1} max={24} value={form.hoursEnd} onChange={set("hoursEnd")} placeholder="17" />
        </label>
        <label>
          Time zone
          <input list="tz" value={form.timeZone} onChange={set("timeZone")} placeholder="America/Chicago" />
          <datalist id="tz">
            {TIME_ZONES.map((tz) => (
              <option key={tz} value={tz} />
            ))}
          </datalist>
        </label>
        <label>
          Max interviews per person per day
          <input type="number" min={1} value={form.maxPerDay} onChange={set("maxPerDay")} placeholder="no limit" />
        </label>
      </div>
      <p className="muted small">
        The pre-interview and invite email texts and the eligibility rules are edited in the Ramps table in Airtable.
        <br />
        Empty fields use the defaults: Monday–Friday, 9:00–17:00 Central, from tomorrow to 14 days ahead.
      </p>
      <fieldset>
        <legend>Who interviews ({form.interviewerIds.length} picked)</legend>
        <div className="pickers">
          {managers.map((m) => (
            <label key={m.id} className="pick">
              <input type="checkbox" checked={form.interviewerIds.includes(m.id)} onChange={() => toggle(m.id)} />
              <span>
                {m.name || m.email}
                <span className="muted small"> {m.email}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label>
        Notes
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </label>
    </div>
  );
}

export function formToBody(form: RampForm) {
  return {
    ...form,
    jobId: form.jobId || null,
    hoursStart: form.hoursStart === "" ? null : Number(form.hoursStart),
    hoursEnd: form.hoursEnd === "" ? null : Number(form.hoursEnd),
    maxPerDay: form.maxPerDay === "" ? null : Number(form.maxPerDay),
  };
}
