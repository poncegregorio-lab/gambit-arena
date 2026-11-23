import { PracticeError, syncPractice } from "@/lib/server/practice";
import type { SyncRequest } from "@/lib/fight/room";

export const dynamic = "force-dynamic";

/** One round trip of a practice duel: the training bot runs on the server and answers over the network. */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { fightId?: string; req?: Partial<SyncRequest> };
    if (typeof body.fightId !== "string" || body.fightId.length < 8) throw new PracticeError("A fight id is required");
    const r = body.req ?? {};
    const res = await syncPractice(body.fightId, {
      state: r.state ?? null,
      events: Array.isArray(r.events) ? r.events : [],
      ack: typeof r.ack === "number" ? r.ack : 0,
      seq: typeof r.seq === "number" ? r.seq : 0,
    });
    return Response.json(res);
  } catch (e) {
    if (e instanceof PracticeError) return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ error: "Practice sync failed." }, { status: 500 });
  }
}
