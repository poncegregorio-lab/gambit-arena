import { GameClient } from "@/components/GameClient";

export const dynamic = "force-dynamic";

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GameClient key={id.toUpperCase()} id={id.toUpperCase()} />;
}
