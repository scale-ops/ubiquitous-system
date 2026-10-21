import { pct, type Quality } from "@/lib/quality";

// Shared quality badge and detail panel for the Select CBs and MediaGen pages.

export function tierClass(tier: string) {
  if (tier.includes("Strong") || tier.includes("Good")) return "badge good";
  if (tier.includes("Watch")) return "badge ok";
  if (tier.includes("At risk")) return "badge risk";
  return "badge low";
}

export function QualityBadge({ q }: { q: Quality }) {
  return (
    <div style={{ marginTop: 4 }}>
      <span className={tierClass(q.tier)}>
        {q.tier}{q.score != null ? ` · ${q.score.toFixed(2)}` : ""}
      </span>
      {q.trend && <span className="muted small" style={{ marginLeft: 6 }}>{q.trend}</span>}
    </div>
  );
}

const n = (value: number | null, digits = 0) => (value == null ? "–" : value.toFixed(digits));

export function QualityPanel({ q }: { q: Quality }) {
  return (
    <div className="review" style={{ marginTop: 12 }}>
      <h4>Platform quality <span className={tierClass(q.tier)}>{q.tier}</span> {q.trend && <span className="muted small">{q.trend}</span>}</h4>
      {q.flags.length > 0 && (
        <ul className="flags">{q.flags.map((f, i) => <li key={i}>{f}</li>)}</ul>
      )}
      <p className="small">
        <b>Score:</b> {n(q.score, 2)} on {n(q.scoredTasks)} tasks · <b>Last 90d:</b> {n(q.score90d, 2)} on {n(q.scoredTasks90d)} tasks ·{" "}
        <b>Defect rate:</b> {pct(q.defectRate)} · <b>Rejection rate:</b> {pct(q.rejectionRate)}
      </p>
      <p className="small">
        <b>QC score:</b> {n(q.qcScore, 2)} ({n(q.qcAudits)} audits) · <b>% good QC / QMS / SBQ:</b>{" "}
        {pct(q.pctGoodQc)} / {pct(q.pctGoodQms)} / {pct(q.pctGoodSbq)}
      </p>
      <p className="small">
        <b>Quality disables:</b> {n(q.disables)} ({n(q.disables90d)} in 90d{q.lastDisable ? `, last ${q.lastDisable}` : ""}) ·{" "}
        <b>Onboarding pass rate:</b> {q.onboardingPassRate || "–"} · <b>Projects:</b> {n(q.projects)} ·{" "}
        <b>Max review level:</b> {n(q.maxReviewLevel)} · <b>Reviews given:</b> {n(q.reviewsGiven)} · <b>Last task:</b> {q.lastTask || "–"}
        {q.tnsFlag && <> · <span className="badge risk">T&amp;S flag</span></>}
      </p>
    </div>
  );
}
