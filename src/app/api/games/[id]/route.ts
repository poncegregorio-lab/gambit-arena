import { errorResponse, getGame, toView, waitForChange } from "@/lib/server/games";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const playerId = url.searchParams.get("playerId");
    const known = url.searchParams.get("v");
    const wait = Math.min(25_000, Math.max(0, Number(url.searchParams.get("wait")) || 0));
    // Long-poll: if the client already has the latest version, hold the request until something changes.
    if (known !== null && wait > 0 && Number.isFinite(Number(known))) {
      await waitForChange(id, Number(known), wait, req.signal);
    }
    const g = await getGame(id);
    if (!g) return Response.json({ error: "Game not found" }, { status: 404 });
    const view = toView(g, playerId);
    if (known !== null && Number(known) === view.version) {
      return Response.json({ unchanged: true, version: view.version });
    }
    return Response.json({ view });
  } catch (e) {
    return errorResponse(e);
  }
}
