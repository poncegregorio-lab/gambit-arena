import { PracticeError, createPractice, syncPractice } from "@/lib/server/practice";

export const dynamic = "force-dynamic";

/** Start a practice duel against the network-served training bot. */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const session = createPractice(body ?? {});
    return Response.json(session);
  } catch (e) {
    if (e instanceof PracticeError) return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ error: "Could not start the practice duel." }, { status: 500 });
  }
}
