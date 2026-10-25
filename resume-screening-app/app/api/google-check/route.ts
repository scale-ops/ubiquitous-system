import { listActiveWorkforceManagers } from "@/lib/airtable";
import { freeBusy, sharedMailbox, testMode } from "@/lib/google";
import { handle } from "@/lib/http";

// Read-only health check for scheduling: can the team mailbox reach Google, and can it see each
// Workforce Manager's free/busy for the next 7 days? Sends nothing and books nothing.
// Optional ?also=someone@scale.com checks one more calendar, e.g. to test sharing before rollout.
export async function GET(request: Request) {
  return handle(async () => {
    const also = new URL(request.url).searchParams.get("also")?.trim().toLowerCase() ?? "";
    const managers = await listActiveWorkforceManagers();
    if (/^[^\s@]+@[^\s@]+$/.test(also) && !managers.some((m) => m.email === also)) {
      managers.push({ id: "", email: also, name: "(extra check)", role: "" });
    }
    const now = new Date();
    const weekLater = new Date(now.getTime() + 7 * 86_400_000);
    const mailbox = sharedMailbox();
    const results = await freeBusy([mailbox, ...managers.map((m) => m.email)], now.toISOString(), weekLater.toISOString());
    const byEmail = new Map(results.map((r) => [r.email, r]));
    return {
      testMode: testMode(),
      mailbox: { email: mailbox, ok: !byEmail.get(mailbox)?.error, error: byEmail.get(mailbox)?.error ?? null },
      managers: managers.map((m) => {
        const r = byEmail.get(m.email);
        return { name: m.name, email: m.email, canSee: !r?.error, busyBlocks: r?.busy.length ?? 0, error: r?.error ?? null };
      }),
    };
  });
}
