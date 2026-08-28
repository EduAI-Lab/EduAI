import { afterAll, describe, expect, it } from "vitest";

import prisma from "~/lib/prisma.server";
import { seedUser } from "../helpers/rbac";

describe("AI interaction chat correlation retention", () => {
  it("keeps chatId on telemetry after the owning chat is deleted", async () => {
    const user = await seedUser({ role: "STUDENT" });
    const chat = await prisma.chat.create({ data: { userId: user.id } });
    const interaction = await prisma.aIInteraction.create({
      data: {
        userId: user.id,
        chatId: chat.id,
        modelUsed: "test:model",
        query: "test query",
        response: "test response",
      },
    });

    await prisma.chat.delete({ where: { id: chat.id } });

    await expect(
      prisma.aIInteraction.findUnique({ where: { id: interaction.id } }),
    ).resolves.toMatchObject({ id: interaction.id, chatId: chat.id });

    await prisma.aIInteraction.delete({ where: { id: interaction.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
