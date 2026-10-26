// Pure helpers for the candidate pipeline: eligibility checks on pre-interview answers, and
// filling in the ramp's email templates. No network calls, so they can be tested on their own.

export type EligibilityRules = {
  minWeeklyHours: number | null;
  weekendsRequired: boolean;
  eightHourRequired: boolean;
  minEnglish: string;
};

export type Answers = {
  country: string;
  otherCountry: string;
  workAuthorization: string;
  english: string;
  eightHour: string;
  days: string[];
  weeklyHours: number | null;
  ackContract: boolean;
};

// "pass" and "fail" are about the ramp's rules; "warn" means worth a look, not disqualifying.
export type Check = { label: string; result: "pass" | "fail" | "warn"; detail: string };

const ENGLISH = ["Basic", "Intermediate", "Advanced", "Fluent", "Native"];

// Country name (as chosen on the form) -> ISO code, using the built-in country list.
let codeByName: Map<string, string> | null = null;
export function countryCode(name: string): string | null {
  if (!name) return null;
  if (!codeByName) {
    codeByName = new Map();
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        try {
          const n = names.of(code);
          // First code wins, so "United Kingdom" stays GB rather than the reserved UK.
          if (n && n !== code && !codeByName.has(n.toLowerCase())) codeByName.set(n.toLowerCase(), code);
        } catch {
          // not a region code
        }
      }
    }
    codeByName.set("united states", "US");
    codeByName.set("usa", "US");
    codeByName.set("uk", "GB");
  }
  return codeByName.get(name.trim().toLowerCase()) ?? null;
}

export function eligibility(a: Answers, rules: EligibilityRules, ipCountry: string, submissionCount: number): Check[] {
  const checks: Check[] = [];
  checks.push({
    label: "Work authorization",
    result: a.workAuthorization === "Yes" ? "pass" : "fail",
    detail: a.workAuthorization || "not answered",
  });
  checks.push({
    label: "Contract duration acknowledged",
    result: a.ackContract ? "pass" : "fail",
    detail: a.ackContract ? "yes" : "not ticked",
  });
  if (rules.minWeeklyHours != null) {
    const ok = (a.weeklyHours ?? 0) >= rules.minWeeklyHours;
    checks.push({ label: `At least ${rules.minWeeklyHours} hours a week`, result: ok ? "pass" : "fail", detail: `${a.weeklyHours ?? "?"} hours` });
  }
  if (rules.weekendsRequired) {
    const ok = a.days.includes("Saturday") || a.days.includes("Sunday");
    checks.push({ label: "Available some weekends", result: ok ? "pass" : "fail", detail: a.days.join(", ") || "no days chosen" });
  }
  if (rules.eightHourRequired) {
    checks.push({ label: "8-hour shifts", result: a.eightHour === "Yes" ? "pass" : "fail", detail: a.eightHour || "not answered" });
  }
  if (rules.minEnglish) {
    const ok = ENGLISH.indexOf(a.english) >= ENGLISH.indexOf(rules.minEnglish);
    checks.push({ label: `English ${rules.minEnglish} or above`, result: ok ? "pass" : "fail", detail: a.english || "not answered" });
  }
  const stated = a.country === "Other" ? a.otherCountry : a.country;
  const statedCode = countryCode(stated);
  if (ipCountry && statedCode && statedCode !== ipCountry) {
    checks.push({ label: "Country matches IP location", result: "warn", detail: `says ${stated}, IP shows ${ipCountry}` });
  } else if (ipCountry && statedCode) {
    checks.push({ label: "Country matches IP location", result: "pass", detail: stated });
  } else {
    checks.push({ label: "Country matches IP location", result: "warn", detail: `couldn't compare (${stated || "no country"} / ${ipCountry || "no IP country"})` });
  }
  if (submissionCount > 1) {
    checks.push({ label: "Duplicate submission", result: "warn", detail: `${submissionCount} submissions from this email` });
  }
  return checks;
}

// ---- Email templates ----

export type TemplateVars = Record<string, string>;

// Replaces {Name} blanks; unknown blanks are left as they are so they're easy to spot.
export function fillTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{([A-Za-z ]+)\}/g, (whole, key: string) => (key in vars ? vars[key] : whole));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// HTML version of a template: links become buttons-style links, line breaks are kept.
export function templateHtml(template: string, vars: TemplateVars, links: Record<string, { url: string; label: string }>): string {
  const marker = (k: string) => `\u0000${k}\u0000`;
  const withMarkers = template.replace(/\{([A-Za-z ]+)\}/g, (whole, key: string) =>
    key in links ? marker(key) : key in vars ? vars[key] : whole,
  );
  let html = escapeHtml(withMarkers).replace(/\n/g, "<br>\n");
  for (const [key, link] of Object.entries(links)) {
    html = html.split(marker(key)).join(`<a href="${escapeHtml(link.url)}"><strong>${escapeHtml(link.label)}</strong></a>`);
  }
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1c1f23">${html}</div>`;
}

export function formatDeadline(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function preInterviewLink(formUrl: string, email: string): string {
  const url = new URL(formUrl);
  url.searchParams.set("prefill_Email", email);
  return url.toString();
}
