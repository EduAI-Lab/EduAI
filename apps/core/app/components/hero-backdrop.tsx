/**
 * Decorative backdrop for the landing hero — soft washes of brand colour and
 * nothing else. No pattern, no texture: the demo reel is the busy element in
 * this section and a grid competing with it made the hero noisy.
 *
 * Purely presentational — `aria-hidden`, behind the hero content, and every
 * colour comes from a theme token so light and dark share one definition.
 * Static by design; the reel supplies all the motion the hero needs.
 */
function Wash({
  className,
  color,
  strength,
}: {
  className: string;
  /** A theme token to bloom outward from. */
  color: string;
  /** Percentage of the token mixed in at the centre. */
  strength: number;
}) {
  return (
    <div
      className={`absolute rounded-full blur-3xl ${className}`}
      style={{
        background: `radial-gradient(circle, color-mix(in oklch, ${color} ${strength}%, transparent) 0%, transparent 70%)`,
      }}
    />
  );
}

export function HeroBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Blue bloom behind the demo panel — the brightest point in the section. */}
      <Wash
        className="-right-24 top-0 h-[38rem] w-[38rem] opacity-40 dark:opacity-30"
        color="var(--primary)"
        strength={55}
      />

      {/* A cooler, wider echo that keeps the right side from ending abruptly. */}
      <Wash
        className="right-1/4 -top-40 h-[30rem] w-[30rem] opacity-25 dark:opacity-20"
        color="var(--primary)"
        strength={35}
      />

      {/* Gold under the headline, picking up the rule beneath the title. */}
      <Wash
        className="-left-32 bottom-4 h-[30rem] w-[30rem] opacity-30 dark:opacity-[0.18]"
        color="var(--gold)"
        strength={50}
      />
    </div>
  );
}
