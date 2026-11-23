import { cleanId, errorResponse } from "@/lib/server/games";
import { syncFight } from "@/lib/server/rooms";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const playerId = cleanId(body.playerId);
    const fightId = String(body.fightId ?? "");
    const r = body.req ?? {};
    const res = await syncFight(id.toUpperCase(), fightId, playerId, {
      state: r.state ?? null,
      events: Array.isArray(r.events) ? r.events : [],
      ack: typeof r.ack === "number" ? r.ack : 0,
    });
    return Response.json(res);
  } catch (e) {
    return errorResponse(e);
  }
}
