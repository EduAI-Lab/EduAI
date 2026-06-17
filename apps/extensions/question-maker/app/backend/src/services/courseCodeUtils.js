/** Normalizes course codes for case- and whitespace-insensitive comparison. */
export function normalizeCourseCode(value) {
  if (!value || typeof value !== 'string') return '';
  return value.replace(/\s+/g, '').toLowerCase();
}
