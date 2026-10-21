import type { ResumeDetail } from "@/app/api/selectcbs/route";

// Full parsed-resume view for one Select CB: work history, education, skills, certifications and publications.
export function ResumeDeepDive({ r }: { r: ResumeDetail }) {
  if (!r.parsed) {
    return <p className="muted small">No parsed resume data on the platform. Open the resume file to review it.</p>;
  }
  return (
    <div className="review" style={{ marginTop: 12 }}>
      <h4>Resume deep dive</h4>
      <p className="small">
        {[
          r.highestDegree && `Highest degree: ${r.highestDegree}`,
          r.seniority && `Seniority: ${r.seniority}`,
          r.latestRole && `Latest role: ${r.latestRole}${r.currentlyEmployed ? " (current)" : ""}`,
          r.careerSpan != null && `Career span: ${r.careerSpan} yrs`,
          r.jobsListed != null && `Jobs listed: ${r.jobsListed}`,
          r.topField && `Top field: ${r.topField}`,
        ].filter(Boolean).join(" · ")}
        {r.topTierSchool && <> · <span className="badge good">Top-tier school</span></>}
        {r.reviewLeadExp && <> · <span className="badge ok">Review / teaching / lead experience</span></>}
      </p>
      {r.experienceByField && <p className="muted small"><b>Experience by field:</b> {r.experienceByField}</p>}
      <div className="grid">
        <div>
          <h4>Work history</h4>
          {r.workHistory.length > 0 ? <ul>{r.workHistory.map((w, i) => <li key={i}>{w}</li>)}</ul> : <p className="muted small">None listed</p>}
        </div>
        <div>
          <h4>Education</h4>
          {r.education.length > 0 ? <ul>{r.education.map((e, i) => <li key={i}>{e}</li>)}</ul> : <p className="muted small">None listed</p>}
          {r.certifications.length > 0 && (
            <>
              <h4>Certifications ({r.certifications.length})</h4>
              <ul>{r.certifications.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </>
          )}
          {r.publications.length > 0 && (
            <>
              <h4>Publications ({r.publications.length})</h4>
              <ul>{r.publications.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </>
          )}
          {r.tests && <p className="small"><b>Tests:</b> {r.tests}</p>}
        </div>
      </div>
      {r.skills.length > 0 && (
        <div className="chips small" style={{ marginTop: 8 }}>
          {r.skills.map((s) => <span key={s} className="chip">{s}</span>)}
        </div>
      )}
      {r.parsedOn && <p className="muted small">Resume parsed on {r.parsedOn}</p>}
    </div>
  );
}
