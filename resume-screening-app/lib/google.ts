// Google Calendar and Gmail, acting as the shared mailbox (GOOGLE_SHARED_MAILBOX).
// Uses the refresh token made once in OAuth Playground; never asks anyone to sign in.
//
// Test mode (SCHEDULING_TEST_MODE=1, or no GOOGLE_REFRESH_TOKEN): nothing is sent to Google.
// Free/busy comes from fake calendars, events get fake Meet links, and emails are only logged.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR = "https://www.googleapis.com/calendar/v3";
const GMAIL = "https://gmail.googleapis.com/gmail/v1";

export type Busy = { start: string; end: string };
export type FreeBusyResult = { email: string; busy: Busy[]; error?: string };
export type CreatedEvent = { eventId: string; meetLink: string };

export function testMode(): boolean {
  return process.env.SCHEDULING_TEST_MODE === "1" || !process.env.GOOGLE_REFRESH_TOKEN;
}

export function sharedMailbox(): string {
  return process.env.GOOGLE_SHARED_MAILBOX || "recruiting@outlier.ai";
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

// ---- Access token (cached until a minute before it expires) ----

let cached: { token: string; expires: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      refresh_token: env("GOOGLE_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !data.access_token) {
    // invalid_grant = the mailbox removed access or the token was revoked; repeat the Playground step.
    throw new Error(`Google mailbox connection failed: ${data.error ?? res.status}`);
  }
  cached = { token: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cached.token;
}

async function google<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", ...init.headers },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Google API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

// ---- Free/busy ----

const FREEBUSY_ERRORS: Record<string, string> = {
  notFound: "Can't see this calendar: its free/busy isn't shared with the team mailbox",
  internalError: "Google couldn't read this calendar right now",
};

const MAX_RANGE_MS = 30 * 86_400_000;

// Busy times for each email's primary calendar between two instants (ISO strings).
// Long ranges are asked for in 30-day pieces and joined back together.
export async function freeBusy(emails: string[], timeMin: string, timeMax: string): Promise<FreeBusyResult[]> {
  const start = Date.parse(timeMin);
  const end = Date.parse(timeMax);
  if (end - start <= MAX_RANGE_MS) return freeBusyOnce(emails, timeMin, timeMax);
  const merged = new Map(emails.map((email) => [email, { email, busy: [] as Busy[], error: undefined as string | undefined }]));
  for (let from = start; from < end; from += MAX_RANGE_MS) {
    const to = Math.min(from + MAX_RANGE_MS, end);
    for (const r of await freeBusyOnce(emails, new Date(from).toISOString(), new Date(to).toISOString())) {
      const m = merged.get(r.email)!;
      m.busy.push(...r.busy);
      m.error ??= r.error;
    }
  }
  return [...merged.values()].map((m) => (m.error ? m : { email: m.email, busy: m.busy }));
}

async function freeBusyOnce(emails: string[], timeMin: string, timeMax: string): Promise<FreeBusyResult[]> {
  if (testMode()) return emails.map((email) => ({ email, busy: fakeBusy(email, timeMin, timeMax) }));
  const results: FreeBusyResult[] = [];
  // Google allows up to 50 calendars per request.
  for (let i = 0; i < emails.length; i += 50) {
    const batch = emails.slice(i, i + 50);
    const data = await google<{ calendars: Record<string, { busy?: Busy[]; errors?: { reason: string }[] }> }>(
      `${CALENDAR}/freeBusy`,
      { method: "POST", body: JSON.stringify({ timeMin, timeMax, items: batch.map((id) => ({ id })) }) },
    );
    for (const email of batch) {
      const cal = data.calendars[email] ?? data.calendars[email.toLowerCase()];
      const reason = cal?.errors?.[0]?.reason;
      results.push({
        email,
        busy: cal?.busy ?? [],
        ...(reason || !cal ? { error: FREEBUSY_ERRORS[reason ?? "notFound"] ?? `Google error: ${reason}` } : {}),
      });
    }
  }
  return results;
}

// ---- Calendar event with a Meet link, on the shared mailbox's calendar ----

export async function createInterviewEvent(input: {
  start: string;
  end: string;
  summary: string;
  description: string;
  attendees: string[];
  requestId: string; // unique per booking, so a retried request can't make two Meet rooms
}): Promise<CreatedEvent> {
  if (testMode()) {
    const id = `test-${input.requestId.slice(0, 12)}`;
    console.log(`[test mode] would create event ${input.start}–${input.end} for ${input.attendees.length} attendees`);
    return { eventId: id, meetLink: `https://meet.google.com/test-${id.slice(5, 9)}-${id.slice(9, 13)}` };
  }
  const event = await google<{ id: string; hangoutLink?: string; conferenceData?: { entryPoints?: { uri: string }[] } }>(
    `${CALENDAR}/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all`,
    {
      method: "POST",
      body: JSON.stringify({
        summary: input.summary,
        description: input.description,
        start: { dateTime: input.start, timeZone: "UTC" },
        end: { dateTime: input.end, timeZone: "UTC" },
        attendees: input.attendees.map((email) => ({ email })),
        conferenceData: { createRequest: { requestId: input.requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } },
        guestsCanSeeOtherGuests: false,
        reminders: { useDefault: true },
      }),
    },
  );
  const meetLink = event.hangoutLink ?? event.conferenceData?.entryPoints?.[0]?.uri ?? "";
  return { eventId: event.id, meetLink };
}

export async function cancelInterviewEvent(eventId: string): Promise<void> {
  if (testMode()) {
    console.log(`[test mode] would cancel event ${eventId}`);
    return;
  }
  await google<void>(`${CALENDAR}/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`, {
    method: "DELETE",
  });
}

// ---- Email from the shared mailbox ----

function mimeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

export type EmailAttachment = { filename: string; mimeType: string; base64: string };

// Base64 wrapped at 76 characters, as email expects.
function wrap76(b64: string): string {
  return b64.replace(/(.{76})/g, "$1\r\n");
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
}): Promise<{ id: string }> {
  if (testMode()) {
    console.log(`[test mode] would email 1 recipient: "${input.subject}" (${input.attachments?.length ?? 0} attachment(s))`);
    return { id: "test-message" };
  }
  const alt = `alt_${crypto.randomUUID()}`;
  const mixed = `mix_${crypto.randomUUID()}`;
  const body = [
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(input.text).toString("base64")),
    ...(input.html
      ? [`--${alt}`, 'Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", wrap76(Buffer.from(input.html).toString("base64"))]
      : []),
    `--${alt}--`,
  ];
  const attachments = input.attachments ?? [];
  const lines = [
    `From: ${mimeHeader("Contractor Operations")} <${sharedMailbox()}>`,
    `To: ${input.to}`,
    `Subject: ${mimeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    ...(attachments.length
      ? [
          `Content-Type: multipart/mixed; boundary="${mixed}"`,
          "",
          `--${mixed}`,
          `Content-Type: multipart/alternative; boundary="${alt}"`,
          "",
          ...body,
          ...attachments.flatMap((a) => [
            `--${mixed}`,
            `Content-Type: ${a.mimeType}; name="${mimeHeader(a.filename)}"`,
            `Content-Disposition: attachment; filename="${mimeHeader(a.filename)}"`,
            "Content-Transfer-Encoding: base64",
            "",
            wrap76(a.base64),
          ]),
          `--${mixed}--`,
        ]
      : [`Content-Type: multipart/alternative; boundary="${alt}"`, "", ...body]),
  ];
  const raw = Buffer.from(lines.join("\r\n")).toString("base64url");
  return google<{ id: string }>(`${GMAIL}/users/me/messages/send`, { method: "POST", body: JSON.stringify({ raw }) });
}

// ---- Fake calendars for test mode ----

// Deterministic per email: each person is busy for a few 30–90 minute blocks on weekdays.
function fakeBusy(email: string, timeMin: string, timeMax: string): Busy[] {
  let seed = 0;
  for (const ch of email) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const busy: Busy[] = [];
  const day = new Date(timeMin);
  day.setUTCHours(0, 0, 0, 0);
  for (; day < new Date(timeMax); day.setUTCDate(day.getUTCDate() + 1)) {
    for (let k = 0; k < 3; k++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const startHour = 13 + (seed % 9); // between 13:00 and 21:00 UTC
      const minutes = 30 * (1 + (seed % 3));
      const start = new Date(day);
      start.setUTCHours(startHour, seed % 2 ? 30 : 0);
      busy.push({ start: start.toISOString(), end: new Date(start.getTime() + minutes * 60_000).toISOString() });
    }
  }
  return busy;
}
