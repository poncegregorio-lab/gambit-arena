import { cleanId, cleanName, errorResponse, joinGame } from "@/lib/server/games";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const view = await joinGame(id, cleanId(body.playerId), cleanName(body.name));
    return Response.json({ view });
  } catch (e) {
    return errorResponse(e);
  }
}
