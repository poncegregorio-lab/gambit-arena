import { cleanId, errorResponse, gameAction } from "@/lib/server/games";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const view = await gameAction(id, cleanId(body.playerId), String(body.action ?? ""));
    return Response.json({ view });
  } catch (e) {
    return errorResponse(e);
  }
}
