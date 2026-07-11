/**
 * AI Tutor stores course/module/lesson names as a single joined `title`
 * ("MATH 320 – Real Analysis", "Module 1 — Foundations of Computing") rather
 * than Core's separate code/name fields. `splitTitle` recovers the two parts by
 * splitting on the first dash separator (em, en, or hyphen, space-padded), so
 * breadcrumbs and the course switcher can show the short code prominently and
 * the full name as a muted sublabel/tooltip. Falls back to the whole title when
 * there is no separator.
 */
export function splitTitle(title: string): { label: string; sublabel?: string } {
  const match = title.match(/^(.*?)\s+[—–-]\s+(.*)$/);
  return match ? { label: match[1], sublabel: match[2] } : { label: title };
}

/**
 * The *name* half of a joined title — the part after the code/order prefix
 * ("Module 1 — Foundations" → "Foundations", "COSC 101 - Computer Studies" →
 * "Computer Studies"). Use this for card/hero headlines where the prefix's
 * number/code is already carried by a visual element (order chip, watermark, or
 * the code eyebrow), so the headline reads as the pure name and no em dash /
 * colon separator is needed. Returns the whole title unchanged when there is no
 * separator.
 */
export function titleName(title: string): string {
  return splitTitle(title).sublabel ?? title;
}

/**
 * The *authored* order token embedded in a title's code/order prefix — the
 * trailing number of the label half ("Lesson 1.1 — Thinking Computationally" →
 * "1.1", "Module 1 — Foundations" → "1"). Use this so a hero eyebrow shows the
 * SAME number a breadcrumb derives from `splitTitle(...).label`, instead of a
 * positional index (`position + 1`) that disagrees with the human-authored
 * numbering. Returns null when the label carries no number.
 */
export function titleNumber(title: string): string | null {
  const match = splitTitle(title).label.match(/(\d+(?:\.\d+)*)\s*$/);
  return match ? match[1] : null;
}
