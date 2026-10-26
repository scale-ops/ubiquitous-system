// Checks for lib/scheduling.ts. Run with: npm test
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const mod = await import(pathToFileURL(resolve(process.argv[2])).href);
const { findSlots, pickInterviewer, stillFree, zonedTimeToUtc, zonedParts, DEFAULT_RULES, bookingRules } = mod;
let passed = 0;
const ok = (name: string, fn: () => void) => { fn(); passed++; console.log("  ✓", name); };

const rules = { ...DEFAULT_RULES }; // Mon–Fri 9–17 America/Chicago, 30 min, 15 min buffer, 24h notice, 14 days
// "Now" = Monday 2026-10-26 08:00 Chicago (13:00 UTC, CDT = UTC-5)
const now = new Date("2026-10-26T13:00:00Z");

ok("zonedTimeToUtc: 9:00 Chicago in October (CDT) = 14:00 UTC", () => {
  assert.equal(zonedTimeToUtc(2026, 10, 27, 9, 0, "America/Chicago").toISOString(), "2026-10-27T14:00:00.000Z");
});
ok("zonedTimeToUtc: 9:00 Chicago after DST ends (CST) = 15:00 UTC", () => {
  assert.equal(zonedTimeToUtc(2026, 11, 2, 9, 0, "America/Chicago").toISOString(), "2026-11-02T15:00:00.000Z");
});
ok("zonedTimeToUtc: month overflow (Oct 32 = Nov 1)", () => {
  assert.equal(zonedTimeToUtc(2026, 10, 32, 12, 0, "America/Chicago").toISOString(), zonedTimeToUtc(2026, 11, 1, 12, 0, "America/Chicago").toISOString());
});

const nobodyBusy = [{ email: "a@x.com", busy: [] }, { email: "b@x.com", busy: [] }];
const slots = findSlots(nobodyBusy, rules, now);

ok("no slot before 24h notice (first is Tue 27 Oct 9:00 Chicago)", () => {
  assert.equal(slots[0].start.toISOString(), "2026-10-27T14:00:00.000Z");
});
ok("16 slots per weekday (9:00–17:00 in 30 min)", () => {
  const tue = slots.filter((s: any) => zonedParts(s.start, "America/Chicago").day === 27);
  assert.equal(tue.length, 16);
  assert.equal(zonedParts(tue[15].start, "America/Chicago").hour, 16);
  assert.equal(zonedParts(tue[15].start, "America/Chicago").minute, 30);
});
ok("no weekend slots", () => {
  assert.ok(slots.every((s: any) => zonedParts(s.start, "America/Chicago").weekday <= 5));
});
ok("window ends 14 days ahead (last day Mon 9 Nov)", () => {
  const last = zonedParts(slots[slots.length - 1].start, "America/Chicago");
  assert.deepEqual([last.month, last.day], [11, 9]);
});
ok("after DST ends, 9:00 Chicago slots move to 15:00 UTC", () => {
  const nov2 = slots.find((s: any) => s.start.toISOString().startsWith("2026-11-02"));
  assert.equal(nov2.start.toISOString(), "2026-11-02T15:00:00.000Z");
});
ok("both interviewers free → each slot lists 2 (parallel interviews possible)", () => {
  assert.ok(slots.every((s: any) => s.free.length === 2));
});

// a@ busy Tue 10:00–11:00 Chicago (15:00–16:00 UTC)
const withBusy = [
  { email: "a@x.com", busy: [{ start: new Date("2026-10-27T15:00:00Z"), end: new Date("2026-10-27T16:00:00Z") }] },
  { email: "b@x.com", busy: [] },
];
const s2 = findSlots(withBusy, rules, now);
const at = (iso: string) => s2.find((s: any) => s.start.toISOString() === iso);
ok("busy person not offered during their meeting", () => {
  assert.deepEqual(at("2026-10-27T15:00:00.000Z").free, ["b@x.com"]);
});
ok("15-min buffer: not offered right before (9:30) or right after (11:00)", () => {
  assert.deepEqual(at("2026-10-27T14:30:00.000Z").free, ["b@x.com"]);
  assert.deepEqual(at("2026-10-27T16:00:00.000Z").free, ["b@x.com"]);
});
ok("free again at 11:30 Chicago", () => {
  assert.deepEqual(at("2026-10-27T16:30:00.000Z").free, ["a@x.com", "b@x.com"]);
});
ok("slot with nobody free is left out", () => {
  const allBusy = [{ email: "a@x.com", busy: [{ start: new Date("2026-10-27T14:00:00Z"), end: new Date("2026-10-27T23:00:00Z") }] }];
  assert.ok(!findSlots(allBusy, rules, now).some((s: any) => s.start.toISOString().startsWith("2026-10-27")));
});

ok("pickInterviewer: fewest upcoming wins", () => {
  assert.equal(pickInterviewer(["a@x.com", "b@x.com"], { "a@x.com": 3, "b@x.com": 1 }), "b@x.com");
});
ok("pickInterviewer: tie → longest since last booking", () => {
  assert.equal(pickInterviewer(["a@x.com", "b@x.com"], {}, { "a@x.com": 200, "b@x.com": 100 }), "b@x.com");
});
ok("pickInterviewer: nobody free → null", () => assert.equal(pickInterviewer([], {}), null));

ok("stillFree: detects a meeting added after the page loaded", () => {
  const slot = { start: new Date("2026-10-27T14:00:00Z"), end: new Date("2026-10-27T14:30:00Z") };
  assert.equal(stillFree([], slot, 15), true);
  assert.equal(stillFree([{ start: new Date("2026-10-27T14:40:00Z"), end: new Date("2026-10-27T15:00:00Z") }], slot, 15), false);
});

ok("bookingRules: env overrides and defaults", () => {
  const r = bookingRules({ BOOKING_TIMEZONE: "America/Mexico_City", BOOKING_START_HOUR: "8", BOOKING_DAYS: "1,2,3" });
  assert.equal(r.timeZone, "America/Mexico_City");
  assert.equal(r.startHour, 8);
  assert.deepEqual(r.days, [1, 2, 3]);
  assert.equal(r.endHour, 17);
});

const { rampRules, dayKey, summarizeByDay, isValidTimeZone } = mod;

ok("ramp: only between Start and End Date", () => {
  const r = rampRules(rules, { startDate: "2026-10-29", endDate: "2026-10-30" });
  const days = [...new Set(findSlots(nobodyBusy, r, now).map((s: any) => dayKey(s.start, "America/Chicago")))];
  assert.deepEqual(days, ["2026-10-29", "2026-10-30"]);
});
ok("ramp: End Date beyond 14 days is honoured", () => {
  const r = rampRules(rules, { startDate: "2026-11-20", endDate: "2026-11-20" });
  assert.equal(findSlots(nobodyBusy, r, now).length, 16);
});
ok("ramp: own hours and time zone (8–10 Mexico City = 4 slots/day)", () => {
  const r = rampRules(rules, { timeZone: "America/Mexico_City", hoursStart: 8, hoursEnd: 10, startDate: "2026-10-28", endDate: "2026-10-28" });
  const s = findSlots(nobodyBusy, r, now);
  assert.equal(s.length, 4);
  assert.equal(s[0].start.toISOString(), "2026-10-28T14:00:00.000Z"); // Mexico City is UTC-6
});
ok("ramp: daily limit removes an interviewer who is full that day", () => {
  const r = rampRules(rules, { startDate: "2026-10-28", endDate: "2026-10-28", maxPerDay: 2 });
  const s = findSlots(nobodyBusy, r, now, { "a@x.com": { "2026-10-28": 2 } });
  assert.ok(s.every((x: any) => x.free.length === 1 && x.free[0] === "b@x.com"));
});
ok("summary by day counts times and per-interviewer spots", () => {
  const r = rampRules(rules, { startDate: "2026-10-28", endDate: "2026-10-29" });
  const sum = summarizeByDay(findSlots(withBusy, r, now), "America/Chicago");
  assert.equal(sum.length, 2);
  assert.equal(sum[0].times, 16);
  assert.equal(sum[0].perInterviewer["b@x.com"], 16);
});
ok("time zone check", () => {
  assert.equal(isValidTimeZone("America/Mexico_City"), true);
  assert.equal(isValidTimeZone("Mars/Base"), false);
});

console.log(`${passed} checks passed`);
