import { getLanInfo } from "@/lib/server/network";

export const dynamic = "force-dynamic";

/** Everything another device needs to open this app over the local WiFi. */
export async function GET() {
  return Response.json(getLanInfo());
}
