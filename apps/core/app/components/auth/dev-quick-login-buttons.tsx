/**
 * One-click sign-in as non-admin test accounts on the shared dev server (#1900).
 *
 * Each button posts only the account's key; the server holds the password and
 * re-checks the account (see `dev-quick-login.server.ts`), so nothing secret is
 * ever in this page.
 */

type DevQuickLoginButtonsProps = {
  /** The same redirect target as the normal sign-in form. */
  redirectTo: string;
  accounts: Array<{ key: string; label: string }>;
};

export function DevQuickLoginButtons({ redirectTo, accounts }: DevQuickLoginButtonsProps) {
  return (
    <div className="mt-6 border-t pt-5">
      <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Dev test accounts
      </p>
      <div className="grid grid-cols-3 gap-1.5">
        {accounts.map(({ key, label }) => (
          <form key={key} method="post">
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <input type="hidden" name="devQuickLogin" value={key} />
            <button
              type="submit"
              className="w-full rounded-md border px-2 py-1.5 text-xs hover:bg-muted"
              title={`Sign in as the ${label.toLowerCase()} test account`}
            >
              {label}
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
