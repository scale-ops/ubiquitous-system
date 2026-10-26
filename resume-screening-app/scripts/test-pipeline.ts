// Checks for lib/pipeline.ts (eligibility and email templates). Run with: npm test
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { eligibility, countryCode, fillTemplate, templateHtml, formatDeadline, preInterviewLink } = await import(
  pathToFileURL(resolve(process.argv[2])).href
);
let passed = 0;
const ok = (name: string, fn: () => void) => { fn(); passed++; console.log("  ✓", name); };

const good = { country: "Mexico", otherCountry: "", workAuthorization: "Yes", english: "Fluent", eightHour: "Yes", days: ["Monday", "Saturday"], weeklyHours: 40, ackContract: true };
const rules = { minWeeklyHours: 40, weekendsRequired: true, eightHourRequired: true, minEnglish: "Advanced" };
const resultOf = (checks: any[], label: string) => checks.find((c) => c.label.startsWith(label))?.result;

ok("all good → every check passes", () => {
  const c = eligibility(good, rules, "MX", 1);
  assert.ok(c.every((x: any) => x.result === "pass"), JSON.stringify(c));
});
ok("too few hours fails", () => assert.equal(resultOf(eligibility({ ...good, weeklyHours: 20 }, rules, "MX", 1), "At least 40"), "fail"));
ok("no weekend day fails when weekends required", () => assert.equal(resultOf(eligibility({ ...good, days: ["Monday"] }, rules, "MX", 1), "Available some weekends"), "fail"));
ok("English below minimum fails", () => assert.equal(resultOf(eligibility({ ...good, english: "Intermediate" }, rules, "MX", 1), "English"), "fail"));
ok("no work authorization fails", () => assert.equal(resultOf(eligibility({ ...good, workAuthorization: "No" }, rules, "MX", 1), "Work authorization"), "fail"));
ok("contract not acknowledged fails", () => assert.equal(resultOf(eligibility({ ...good, ackContract: false }, rules, "MX", 1), "Contract"), "fail"));
ok("country differs from IP → warning, not fail", () => assert.equal(resultOf(eligibility(good, rules, "US", 1), "Country matches"), "warn"));
ok("'Other' country uses the typed name", () => assert.equal(resultOf(eligibility({ ...good, country: "Other", otherCountry: "Guatemala" }, rules, "GT", 1), "Country matches"), "pass"));
ok("duplicate submissions flagged", () => assert.equal(resultOf(eligibility(good, rules, "MX", 3), "Duplicate"), "warn"));
ok("rules left empty aren't checked", () => {
  const c = eligibility({ ...good, weeklyHours: 5, days: [] }, { minWeeklyHours: null, weekendsRequired: false, eightHourRequired: false, minEnglish: "" }, "MX", 1);
  assert.equal(c.length, 3);
});
ok("country names map to codes", () => {
  assert.equal(countryCode("United States"), "US");
  assert.equal(countryCode("Philippines"), "PH");
  assert.equal(countryCode("United Kingdom"), "GB");
});
ok("template blanks filled; unknown blanks left visible", () => {
  assert.equal(fillTemplate("Hi {First Name}, {Job Title} by {Nope}", { "First Name": "Ana", "Job Title": "QA Reviewer" }), "Hi Ana, QA Reviewer by {Nope}");
});
ok("HTML version links and escapes", () => {
  const h = templateHtml("Hi {First Name} <b>\n{Apply Link}", { "First Name": "Ana" }, { "Apply Link": { url: "https://x.test/?a=1&b=2", label: "Apply here" } });
  assert.ok(h.includes("Hi Ana &lt;b&gt;<br>"));
  assert.ok(h.includes('<a href="https://x.test/?a=1&amp;b=2"><strong>Apply here</strong></a>'));
});
ok("deadline formatting", () => assert.equal(formatDeadline("2026-11-07"), "November 7, 2026"));
ok("pre-interview link prefills email", () => {
  assert.equal(preInterviewLink("https://airtable.com/app/pag/form", "a+b@x.com"), "https://airtable.com/app/pag/form?prefill_Email=a%2Bb%40x.com");
});

console.log(`${passed} checks passed`);
