"use client";

import { useState } from "react";

type Check = {
  testMode: boolean;
  mailbox: { email: string; ok: boolean; error: string | null };
  managers: { name: string; email: string; canSee: boolean; busyBlocks: number; error: string | null }[];
};

export default function GoogleCheck() {
  const [result, setResult] = useState<Check | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    setError("");
    try {
      const res = await fetch("/api/google-check");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const visible = result?.managers.filter((m) => m.canSee).length ?? 0;
  return (
    <main>
      <h1>Scheduling connection check</h1>
      <p className="muted">
        Checks that the team mailbox can reach Google, and whether it can see each Workforce Manager&apos;s free/busy
        times for the next 7 days. It doesn&apos;t send email or book anything.
      </p>
      <button className="primary" onClick={run} disabled={running}>
        {running ? "Checking…" : "Run check"}
      </button>
      {error && <p className="error">{error}</p>}
      {result && (
        <div className="card">
          {result.testMode && (
            <p className="error">Test mode is on: these are fake calendars, not real Google data.</p>
          )}
          <p>
            <strong>Team mailbox</strong> ({result.mailbox.email}):{" "}
            {result.mailbox.ok ? "connected ✓" : `problem: ${result.mailbox.error}`}
          </p>
          <p>
            <strong>Workforce Managers:</strong> can see {visible} of {result.managers.length}
          </p>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Free/busy</th>
                <th>Busy blocks (7 days)</th>
              </tr>
            </thead>
            <tbody>
              {result.managers.map((m) => (
                <tr key={m.email}>
                  <td>{m.name || "—"}</td>
                  <td>{m.email}</td>
                  <td>{m.canSee ? "✓ visible" : m.error}</td>
                  <td>{m.canSee ? m.busyBlocks : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
