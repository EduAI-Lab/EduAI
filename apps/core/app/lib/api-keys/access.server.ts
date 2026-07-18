import prisma from "~/lib/prisma.server";

export async function isActiveAdminUser(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isActive: true },
  });
  return user?.role === "ADMIN" && user.isActive === true;
}
