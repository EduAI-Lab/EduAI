const BOOTSTRAP_ADMIN_EMAILS = [
  'abdallah.mohamed@ubc.ca',
  'mostafa.mohamed@ubc.ca',
  'stavan@student.ubc.ca',
];

export function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function getBootstrapAdminEmails() {
  return BOOTSTRAP_ADMIN_EMAILS;
}

export function isBootstrapAdminEmail(email) {
  const normalized = normalizeEmail(email);
  return normalized.length > 0 && BOOTSTRAP_ADMIN_EMAILS.includes(normalized);
}
