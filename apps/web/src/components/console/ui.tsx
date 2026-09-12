/**
 * The four primitives the console route is built from.
 *
 * Nothing else in the tree may invent a surface. The whole screen is a panel, a stat, a chip and a
 * label — small enough to read in one sitting, which is what keeps a dense instrument visually
 * consistent for free.
 *
 * `tag` on a panel is where the panel's provenance lives, and it is not decoration: it is the reason
 * the screen can be trusted, because every number on it says where it came from.
 */
export function Panel({
  title,
  tag,
  children,
  className = "",
}: {
  title: string;
  /** where this panel's numbers came from; shown small and to the right */
  tag?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex min-h-0 flex-col border border-stroke bg-panel ${className}`}>
      <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-stroke px-3">
        <h2 className="label-sm m-0 text-ink-soft">{title}</h2>
        {tag === undefined ? null : (
          <span className="truncate border border-stroke px-1.5 py-0.5 text-[10px] text-ink-faint">{tag}</span>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-hidden p-3">{children}</div>
    </section>
  );
}

/**
 * A label over a value.
 *
 * `tone` is a step on the ink ladder, not a hue: severity is brightness here, and the accent is
 * spent only on the Zentis signal itself — the shift, the band, the trigger.
 */
export function Stat({
  label,
  value,
  sub,
  tone = "ink",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "ink" | "soft" | "faint" | "signal" | "warn" | "bad";
}) {
  const colour = {
    ink: "text-ink",
    soft: "text-ink-soft",
    faint: "text-ink-faint",
    signal: "text-em",
    warn: "text-warn",
    bad: "text-bad",
  }[tone];
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="label-sm text-ink-faint">{label}</span>
      <span className={`tnum font-mono text-fs-0 leading-none ${colour}`}>{value}</span>
      {sub === undefined ? null : <span className="truncate text-[10px] text-ink-faint">{sub}</span>}
    </div>
  );
}

/** A keycap. The only thing on this screen that is pressed rather than read. */
export function Chip({
  children,
  onClick,
  active = false,
  title,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`label-sm h-[18px] border px-2 leading-none transition-colors ${
        active
          ? "border-em text-em"
          : "border-stroke text-ink-faint hover:border-line2 hover:text-ink-soft disabled:hover:border-stroke disabled:hover:text-ink-faint"
      } disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

export const Rule = () => <div className="h-px w-full bg-stroke" />;
