"use client";

import { useEffect, useMemo, useState } from "react";

type Slot = { start: string; end: string };
type View =
  | { state: "invalid" | "expired" | "closed" }
  | { state: "booked"; firstName: string; role: string; start: string; end: string; meetLink: string }
  | { state: "open"; firstName: string; role: string; minutes: number; slots: Slot[] };

const ZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Mexico_City",
  "America/Bogota",
  "America/Lima",
  "America/Argentina/Buenos_Aires",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Madrid",
  "Africa/Lagos",
  "Asia/Kolkata",
  "Asia/Manila",
];

function fmt(iso: string, timeZone: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, ...opts }).format(new Date(iso));
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="book">
      <div className="card">{children}</div>
    </main>
  );
}

export default function BookingClient({ code }: { code: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [zone, setZone] = useState("UTC");
  const [picked, setPicked] = useState<Slot | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setError("");
    fetch(`/api/book/${code}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setView(d)))
      .catch(() => setError("We couldn't load interview times. Please check your connection and reload."));
  };

  useEffect(() => {
    setZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    load();
  }, [code]);

  const days = useMemo(() => {
    if (view?.state !== "open") return [];
    const groups = new Map<string, Slot[]>();
    for (const s of view.slots) {
      const key = fmt(s.start, zone, { weekday: "long", month: "long", day: "numeric" });
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    return [...groups.entries()];
  }, [view, zone]);

  async function confirm() {
    if (!picked) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/book/${code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: picked.start, timeZone: zone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setPicked(null);
        load();
        return;
      }
      setView({ state: "booked", firstName: view?.state === "open" ? view.firstName : "", role: data.role, ...data });
    } finally {
      setSaving(false);
    }
  }

  if (!view) {
    return <Shell>{error ? <p className="error">{error}</p> : <p className="muted">Loading interview times…</p>}</Shell>;
  }

  if (view.state !== "open" && view.state !== "booked") {
    const message = {
      invalid: "This booking link isn't valid. Please check you copied the whole link from your email.",
      expired: "This booking link has expired. Please reply to the email you received and we'll send a new one.",
      closed: "Booking is closed for this interview. Please reply to the email you received if you have questions.",
    }[view.state];
    return (
      <Shell>
        <h1>Interview booking</h1>
        <p>{message}</p>
      </Shell>
    );
  }

  if (view.state === "booked") {
    return (
      <Shell>
        <h1>You&apos;re booked{view.firstName ? `, ${view.firstName}` : ""}!</h1>
        {view.role && <p className="muted">{view.role}</p>}
        <p className="when">
          {fmt(view.start, zone, { weekday: "long", month: "long", day: "numeric" })}
          <br />
          {fmt(view.start, zone, { hour: "numeric", minute: "2-digit" })} – {fmt(view.end, zone, { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}
        </p>
        {view.meetLink && (
          <p>
            Join on Google Meet: <a href={view.meetLink}>{view.meetLink}</a>
          </p>
        )}
        <p className="muted small">
          A calendar invitation with this link has been sent to your email. Need to change the time? Reply to the email you
          received from us.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1>Pick a time for your interview{view.firstName ? `, ${view.firstName}` : ""}</h1>
      <p className="muted">
        {view.role ? `${view.role} · ` : ""}
        {view.minutes}-minute video interview on Google Meet
      </p>
      <label className="zone">
        Times shown in
        <select value={zone} onChange={(e) => setZone(e.target.value)}>
          {[...new Set([zone, ...ZONES])].map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="error">{error}</p>}

      {picked ? (
        <div className="confirm">
          <p>
            <strong>{fmt(picked.start, zone, { weekday: "long", month: "long", day: "numeric" })}</strong>
            <br />
            {fmt(picked.start, zone, { hour: "numeric", minute: "2-digit" })} – {fmt(picked.end, zone, { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}
          </p>
          <div className="actions">
            <button className="primary" onClick={confirm} disabled={saving}>
              {saving ? "Booking…" : "Book this time"}
            </button>
            <button onClick={() => setPicked(null)} disabled={saving}>
              Choose another time
            </button>
          </div>
        </div>
      ) : days.length === 0 ? (
        <p>There are no open times right now. Please check back later, or reply to the email you received.</p>
      ) : (
        days.map(([day, slots]) => (
          <div key={day} className="day">
            <h4>{day}</h4>
            <div className="times">
              {slots.map((s) => (
                <button key={s.start} onClick={() => setPicked(s)}>
                  {fmt(s.start, zone, { hour: "numeric", minute: "2-digit" })}
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </Shell>
  );
}
