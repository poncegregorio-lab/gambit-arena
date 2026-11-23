import type { Color, PieceType } from "@/lib/chess";
import { PIECES, type WeaponDef } from "@/lib/fight/weapons";
import { PieceIcon } from "./PieceIcon";

export function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-[#8d96ab]">
      <span className="w-12 shrink-0 uppercase tracking-wider">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} />
      </div>
    </div>
  );
}

function WeaponStats({ w }: { w: WeaponDef }) {
  const chips: string[] = [];
  if (w.kind === "melee") chips.push(`${w.damage} dmg`, `charged ${Math.round(w.damage * (w.chargedMult ?? 1))}`);
  else {
    chips.push(`${w.damage} dmg`);
    if (w.headMult > 1) chips.push(`head ${Math.round(w.damage * w.headMult * 10) / 10}`);
  }
  if (w.splash) chips.push(`splash ${w.splashDamage ?? w.damage}`);
  chips.push(w.chargeTime ? `${w.chargeTime}s charge` : `${(1 / w.cooldown).toFixed(w.cooldown < 0.2 ? 0 : 1)}/s`);
  if (w.mag) chips.push(`${w.mag} rounds`);
  if (w.pierce) chips.push("pierces cover");
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span key={c} className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10.5px] font-medium text-[#c3cadb]">
          {c}
        </span>
      ))}
    </div>
  );
}

function ControlRow({ keys, title, children }: { keys: string[]; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex w-14 shrink-0 flex-col items-start gap-1 pt-0.5">
        {keys.map((k) => (
          <Key key={k}>{k}</Key>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-white">{title}</div>
        <div className="text-[13px] leading-snug text-[#9aa3b8]">{children}</div>
      </div>
    </div>
  );
}

export function PieceControls({ piece }: { piece: PieceType }) {
  const d = PIECES[piece];
  return (
    <div className="space-y-3">
      <ControlRow keys={[d.primary.button]} title={d.primary.name}>
        {d.primary.blurb}
        <WeaponStats w={d.primary} />
      </ControlRow>
      {d.secondary && (
        <ControlRow keys={[d.secondary.button]} title={d.secondary.name}>
          {d.secondary.blurb}
          <WeaponStats w={d.secondary} />
        </ControlRow>
      )}
      {d.aim && (
        <ControlRow keys={["RMB"]} title={`${d.aim.label} (hold)`}>
          {d.aim.blurb}
        </ControlRow>
      )}
      {d.abilities.map((a) => (
        <ControlRow key={a.id} keys={[a.key]} title={`${a.name} · ${a.cooldown}s cooldown`}>
          {a.blurb}
        </ControlRow>
      ))}
      {d.primary.mag && (
        <ControlRow keys={["R"]} title="Reload">
          {d.primary.reload}s to reload your {d.primary.name.toLowerCase()}.
        </ControlRow>
      )}
      <ControlRow keys={["Shift"]} title="Sprint">
        Hold while moving forward to run about 30% faster. You can&apos;t aim or shoot a gun while sprinting.
      </ControlRow>
      <ControlRow keys={["W", "A", "S", "D"]} title="Move · Space to jump">
        Hop onto the low crates, hide behind the tall pillars. Arrow keys also look around if your mouse can&apos;t be captured.
      </ControlRow>
    </div>
  );
}

export function PieceGuideCard({
  piece,
  color = "w",
  compact = false,
}: {
  piece: PieceType;
  color?: Color;
  compact?: boolean;
}) {
  const d = PIECES[piece];
  return (
    <article className="card overflow-hidden">
      <div
        className="flex items-center gap-4 border-b border-white/[0.06] p-4"
        style={{ background: `linear-gradient(90deg, ${d.accent}22, transparent 70%)` }}
      >
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-white/[0.06] ring-1 ring-white/10">
          <PieceIcon type={piece} color={color} size={52} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="text-lg font-semibold text-white">{d.name}</h3>
            <span className="text-xs font-medium uppercase tracking-wider" style={{ color: d.accent }}>
              {d.title}
            </span>
          </div>
          <p className="mt-0.5 text-[13px] leading-snug text-[#9aa3b8]">{d.guide.summary}</p>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {!compact && (
          <div className="grid gap-1.5 sm:grid-cols-3 sm:gap-4">
            <Bar label="Health" value={d.hp} max={240} color="#4ade80" />
            <Bar label="Speed" value={d.speed} max={9.6} color="#5ab4ff" />
            <Bar label="Power" value={d.power} max={6} color={d.accent} />
          </div>
        )}

        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6f788d]">Controls</div>
          <PieceControls piece={piece} />
          {d.passive && (
            <div className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3 text-[13px] leading-snug text-[#9aa3b8]">
              <span className="font-semibold" style={{ color: d.accent }}>
                Passive — {d.passive.name}.
              </span>{" "}
              {d.passive.blurb}
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6f788d]">How to play it</div>
          <ul className="space-y-1.5 text-[13px] leading-snug text-[#b4bbcd]">
            {(compact ? d.guide.howTo.slice(0, 3) : d.guide.howTo).map((t, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full" style={{ background: d.accent }} />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>

        {!compact && (
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl bg-emerald-500/[0.08] p-3 text-[13px] text-emerald-200/90">
              <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">Strong against</div>
              {d.guide.strongVs}
            </div>
            <div className="rounded-xl bg-rose-500/[0.08] p-3 text-[13px] text-rose-200/90">
              <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-rose-300">Weak against</div>
              {d.guide.weakVs}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
