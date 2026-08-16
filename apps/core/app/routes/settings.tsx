import { redirect, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { isPasswordExpired, getPasswordChangedAt } from "~/lib/auth/password-expiry.server";

import { readStoredStudentId } from "~/lib/canvas/student-id.server";
import prisma from "~/lib/prisma.server";
import { CoreAppShell } from "~/components/layout/core-app-shell";
import { SettingsView } from "~/components/settings/settings-view";
import { getRequestSession } from "~/lib/auth/request-session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getRequestSession(request);
  if (!session?.user) {
    return redirect("/auth/login");
  }

  let studentNumber: string | null = null;
  if (session.user.role === "STUDENT") {
    const row = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { studentId: true },
    });
    studentNumber = readStoredStudentId(row?.studentId);
  }

  const url = new URL(request.url);
  const passwordExpired =
    url.searchParams.get("expired") === "1" ||
    isPasswordExpired(await getPasswordChangedAt(session.user.id));

  const providerSettingsRows = await prisma.userProviderSettings.findMany({
    where: { userId: session.user.id, apiKeyExpiresAt: { not: null } },
    select: {
      apiKeyExpiresAt: true,
      provider: { select: { name: true } },
    },
  });

  // Keyed by provider name (e.g. "openai") → "YYYY-MM-DD"
  const providerExpiries: Record<string, string> = {};
  for (const row of providerSettingsRows) {
    if (row.apiKeyExpiresAt) {
      providerExpiries[row.provider.name] = row.apiKeyExpiresAt.toISOString().split("T")[0];
    }
  }

  return { user: session.user, studentNumber, passwordExpired, providerExpiries };
}

export async function action({ request }: ActionFunctionArgs) {
  const session = await getRequestSession(request);
  if (!session?.user) return redirect("/auth/login");

  const formData = await request.formData();
  const _action = formData.get("_action");

  if (_action === "setExpiry") {
    const providerName = String(formData.get("providerName") || "");
    const rawDate = String(formData.get("apiKeyExpiresAt") || "");

    if (!providerName) return { ok: false };

    const provider = await prisma.aIProvider.findUnique({ where: { name: providerName } });
    if (!provider) return { ok: false };

    const expiresAt = rawDate ? new Date(rawDate) : null;
    if (expiresAt && isNaN(expiresAt.getTime())) return { ok: false };

    await prisma.userProviderSettings.upsert({
      where: { userId_providerId: { userId: session.user.id, providerId: provider.id } },
      create: { userId: session.user.id, providerId: provider.id, apiKeyExpiresAt: expiresAt },
      update: { apiKeyExpiresAt: expiresAt },
    });

    return { ok: true };
  }

  return null;
}

export default function SettingsPage() {
  const { user, studentNumber, passwordExpired, providerExpiries } = useLoaderData<typeof loader>();

  return (
    <CoreAppShell user={user}>
      <SettingsView
        role={user.role ?? undefined}
        studentNumber={studentNumber}
        passwordExpired={passwordExpired}
        providerExpiries={providerExpiries}
      />
    </CoreAppShell>
  );
}
