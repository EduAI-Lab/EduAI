import express from "express";
import { prisma } from "../config/database.js";
import { requireRole } from "../middleware/auth.js";
import { sendSafeError } from "../utils/safeErrors.js";

const router = express.Router();

// Admin ⊇ instructor everywhere else in the app; a bare "INSTRUCTOR" here used
// to 403 ADMIN/UNIT_ADMIN off the prompt-template store.
const TEACHING_ROLES = ["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"];

function createPromptSlug(name) {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "prompt"
  );
}

async function resolveUniquePromptSlug(name) {
  const baseSlug = createPromptSlug(name);
  const matches = await prisma.promptTemplate.findMany({
    where: {
      slug: {
        startsWith: baseSlug,
      },
    },
    select: { slug: true },
  });

  const existing = new Set(matches.map((match) => match.slug));
  if (!existing.has(baseSlug)) {
    return baseSlug;
  }

  let suffix = 2;
  while (existing.has(`${baseSlug}-${suffix}`)) {
    suffix += 1;
  }

  return `${baseSlug}-${suffix}`;
}

router.get("/prompts", requireRole(TEACHING_ROLES), async (req, res) => {
  try {
    const prompts = await prisma.promptTemplate.findMany({
      orderBy: { updatedAt: "desc" },
    });
    res.json(prompts);
  } catch (e) {
    sendSafeError(res, e, "Internal server error");
  }
});

router.post("/prompts", requireRole(TEACHING_ROLES), async (req, res) => {
  const { name, systemPrompt, temperature, topP } = req.body || {};

  if (!name || !systemPrompt) {
    return res.status(400).json({ error: "name and systemPrompt are required" });
  }

  try {
    const slug = await resolveUniquePromptSlug(name);
    const prompt = await prisma.promptTemplate.create({
      data: {
        name,
        slug,
        systemPrompt,
        temperature: typeof temperature === "number" ? temperature : null,
        topP: typeof topP === "number" ? topP : null,
      },
    });
    res.status(201).json(prompt);
  } catch (e) {
    sendSafeError(res, e, "Internal server error");
  }
});

export default router;
