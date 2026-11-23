import Link from "next/link";
import { PieceGuideCard } from "@/components/PieceGuide";
import { Armory } from "@/components/Armory";
import { MapPreview } from "@/components/MapPicker";
import { MAPS } from "@/lib/fight/maps";
import { PIECE_ORDER } from "@/lib/fight/weapons";

export const metadata = { title: "Piece guide — Gambit Arena" };

const RULES: [string, string][] = [
  ["Chess is chess", "Every normal rule applies: castling, en passant, promotion, check, checkmate, stalemate, the fifty-move rule and repetition."],
  ["Captures start a duel", "When you capture, both pieces are dropped into a 3D arena. The attacker spawns at one end, the defender at the other."],
  ["Win the duel, win the square", "If the attacker wins, the capture goes through. If the defender wins, the attacker is destroyed, the defender stays put, and it's the opponent's turn."],
  ["75 seconds", "Reduce your opponent's health to zero to win. When time runs out, whoever has the higher health percentage wins. A tie goes to the defender."],
  ["The King is special", "Kings can never be captured in the normal way — you win by checkmate. But a King that takes part in a duel and loses ends the game on the spot."],
  ["Don't leave", "If you disconnect or never enter the arena, you forfeit the duel."],
];

export default function GuidePage() {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-10">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-white">Piece guide</h1>
        <p className="mt-2 text-[#9aa3b8]">
          Every piece has its own weapons, ability and stats. The King and Queen are the strongest on purpose — and the King has the most to lose.
        </p>
        <div className="mt-4 flex gap-3">
          <Link href="/practice" className="btn btn-primary">
            🎯 Practice against a bot
          </Link>
          <Link href="/" className="btn btn-ghost">
            Back to lobby
          </Link>
        </div>
      </div>

      <Armory />

      <section className="card mt-8 p-5">
        <h2 className="text-lg font-semibold text-white">🤖 A chess player and a fighter — tuned separately</h2>
        <p className="mt-2 text-sm leading-relaxed text-[#9aa3b8]">
          Choose <strong className="text-white">Play a bot</strong> in the lobby for a complete chess match, including capture duels whether you or the bot attacks.
          Both skills have Easy, Medium, Hard, and Expert levels, and you can mix any pair.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-[#5ab4ff]/20 bg-[#5ab4ff]/5 p-4">
            <h3 className="text-sm font-semibold text-[#9ad1ff]">♟ Chess difficulty</h3>
            <p className="mt-1 text-[13px] text-[#9aa3b8]">Controls how far the bot searches, its positional judgement, and how often it makes mistakes on the board. It does not change the bot&apos;s aim or combat abilities.</p>
          </div>
          <div className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-4">
            <h3 className="text-sm font-semibold text-amber-200">⚔ Capture fight difficulty</h3>
            <p className="mt-1 text-[13px] text-[#9aa3b8]">Controls reactions, aim, strafing, and ability use in the arena. It never adds health or damage, and it does not change which chess moves the bot chooses.</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-[#8d96ab]">Try Expert chess with Easy fights to learn strategy, or Easy chess with Expert fights to train your aim. You can adjust either setting on your turn between duels. Practice mode has its own combat selector.</p>
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-[#6f788d]">How duels work</h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {RULES.map(([t, d]) => (
            <div key={t} className="card p-4">
              <div className="text-sm font-semibold text-white">{t}</div>
              <p className="mt-1 text-[13px] leading-snug text-[#8d96ab]">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-[0.16em] text-[#6f788d]">Arenas</h2>
        <p className="mb-3 text-sm text-[#8d96ab]">
          Pick a fixed arena or let each capture roll a random one. Every arena is perfectly point-symmetric, so neither side starts with an edge.
          Hold <strong className="text-white">Shift</strong> to sprint, climb the stairs to raised decks, and use the radar to keep your bearings.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MAPS.map((m) => (
            <div key={m.id} className="card flex gap-3 p-3">
              <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-black/30 p-1.5">
                <MapPreview map={m} className="h-full w-full" />
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-white">{m.name}</div>
                <div className="text-[11px] text-[#6f788d]">
                  {m.halfX * 2}×{m.halfZ * 2} m
                </div>
                <p className="mt-1 text-[12.5px] leading-snug text-[#9aa3b8]">{m.tagline}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-[#6f788d]">Strongest to weakest</h2>
        <div className="grid items-start gap-5 lg:grid-cols-2">
          {PIECE_ORDER.map((p) => (
            <PieceGuideCard key={p} piece={p} color="w" />
          ))}
        </div>
      </section>
    </main>
  );
}
