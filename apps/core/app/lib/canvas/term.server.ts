/**
 * UBC academic term codes derived from a course start date (Pacific time).
 *
 * - Sep–Dec: Winter Term 1 (W1)
 * - Jan–Apr: Winter Term 2 (W2)
 * - May–Jun: Summer Term 1 (S1)
 * - Jul–Aug: Summer Term 2 (S2)
 */
const UBC_TIME_ZONE = "America/Vancouver";

function monthInUbcTimeZone(date: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: UBC_TIME_ZONE,
      month: "numeric",
    }).format(date),
  );
}

export function ubcTermFromDate(date: Date): string {
  const month = monthInUbcTimeZone(date);

  if (month >= 9 && month <= 12) return "W1";
  if (month >= 1 && month <= 4) return "W2";
  if (month >= 5 && month <= 6) return "S1";
  if (month >= 7 && month <= 8) return "S2";

  return "W1";
}
