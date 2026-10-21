import type { SelectCb } from "@/app/api/selectcbs/route";

export function badgeClass(verdict: string) {
  if (verdict === "Strong fit" || verdict === "Good fit") return "badge good";
  if (verdict === "Possible fit") return "badge ok";
  return "badge low";
}

// One-line "why": the main strength for people who fit, otherwise the main reason they don't.
function summary(p: SelectCb) {
  if (["Not a fit", "Can't assess", "Not eligible"].includes(p.status)) return p.concerns[0] ?? "";
  const strength = p.why.find((w) => !w.startsWith("Background:")) ?? p.why[0] ?? "";
  const concern = p.concerns.find((g) => g !== "None significant");
  return concern ? `${strength}. Watch: ${concern}` : strength;
}

// One Select CB in the table, laid out like the BDR/WPC results. Click to show strengths and gaps.
export function PersonRow(props: { p: SelectCb; open: boolean; onToggle: () => void }) {
  const { p, open, onToggle } = props;
  return (
    <>
      <tr className="clickable" onClick={onToggle}>
        <td>{p.rank ?? "–"}</td>
        <td>
          <strong>{p.name}</strong>
          <div className="muted small">{p.profile || p.mainField}</div>
          {p.domain && <div className="muted small">{p.domain}</div>}
        </td>
        <td>
          <span className={badgeClass(p.verdict)}>{p.score != null ? `${p.score} · ` : ""}{p.verdict || "–"}</span>
          {p.status !== p.verdict && <div className="muted small">{p.status}</div>}
        </td>
        <td>{summary(p)}</td>
      </tr>
      {open && (
        <tr className="details">
          <td />
          <td colSpan={3}>
            <div className="grid">
              {p.why.length > 0 && (
                <div>
                  <h4>Strengths</h4>
                  <ul>{p.why.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </div>
              )}
              <div>
                <h4>Gaps</h4>
                <ul>{p.concerns.map((g, i) => <li key={i}>{g}</li>)}</ul>
              </div>
            </div>
            <p className="small">
              <b>Email:</b> {p.email || "n/a"} · <b>Main field:</b> {p.mainField || "n/a"} · <b>Roster:</b>{" "}
              {[p.tier, p.team].filter(Boolean).join(", ") || "n/a"}
              {p.performance != null && <> · <b>Performance:</b> {p.performance}</>}
              {p.hoursPerWeek != null && <> · <b>Paid hrs/week (4w):</b> {p.hoursPerWeek}</>}
            </p>
            {p.hasResume && (
              <div className="actions">
                <a href={`/api/resume?pool=${encodeURIComponent("Select CBs")}&id=${p.id}`} target="_blank" rel="noreferrer">Open resume</a>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
