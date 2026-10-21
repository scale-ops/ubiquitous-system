import type { MediaGenCandidate } from "@/app/api/mediagen/route";
import { badgeClass, summary } from "./helpers";

// One candidate in the rankings table, laid out like the BDR/WPC results. Click to show strengths and gaps.
export function CandidateRow(props: { c: MediaGenCandidate; showDomain: boolean; open: boolean; onToggle: () => void }) {
  const { c, showDomain, open, onToggle } = props;
  return (
    <>
      <tr className="clickable" onClick={onToggle}>
        <td>{c.rank ?? "–"}</td>
        <td>
          <strong>{c.name}</strong>
          {c.selectCb && <span className="badge ok" style={{ marginLeft: 6 }}>Select CB</span>}
          <div className="muted small">{c.profile}</div>
          {showDomain && <div className="muted small">{c.domain}</div>}
        </td>
        <td>
          <span className={badgeClass(c.verdict)}>{c.score != null ? `${c.score} · ` : ""}{c.verdict || "–"}</span>
          <div className="muted small">{c.status}</div>
        </td>
        <td>{summary(c)}</td>
      </tr>
      {open && (
        <tr className="details">
          <td />
          <td colSpan={3}>
            <div className="grid">
              <div>
                <h4>Strengths</h4>
                <ul>{c.why.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </div>
              <div>
                <h4>Gaps</h4>
                <ul>{c.concerns.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </div>
            </div>
            <p className="small">
              <b>Email:</b> {c.email || "n/a"} · <b>Experience:</b> {c.notes || "n/a"} · <b>Education:</b> {c.degree || "n/a"}
            </p>
            <p className="muted small">
              {[
                c.country && `Country: ${c.country}`,
                c.yearsInField != null && `Years in field: ${c.yearsInField}`,
                c.certifications && `Certifications: ${c.certifications}`,
                c.quality && `Platform quality: ${c.quality}`,
                c.availability && `Availability: ${c.availability}`,
                c.lastPaidWork && `Last paid work: ${c.lastPaidWork}`,
                c.rosterTier && `Roster: ${c.rosterTier}`,
                c.team && `Source/team: ${c.team}`,
                c.alsoQualifiedIn && `Also qualified in: ${c.alsoQualifiedIn}`,
                c.mediagenCheck && `MediaGen check: ${c.mediagenCheck}`,
              ].filter(Boolean).join(" · ")}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}
