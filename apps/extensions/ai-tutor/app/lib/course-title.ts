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
