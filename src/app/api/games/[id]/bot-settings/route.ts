import { cleanId, errorResponse, updateBotSettings } from "@/lib/server/games";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const view = await updateBotSettings(id, cleanId(body.playerId), body.settings);
    return Response.json({ view });
  } catch (e) {
    return errorResponse(e);
  }
}
