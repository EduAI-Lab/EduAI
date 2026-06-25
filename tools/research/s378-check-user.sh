#!/usr/bin/env bash
set -euo pipefail
CORE=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core
cd "$CORE"

echo "=== prompts file ==="
find /srv/www/dev.eduai.ok.ubc.ca/EduAICore -name 'prompts.v1.jsonl' 2>/dev/null || true

echo "=== user enrollments ==="
npx tsx -e '
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const u = await prisma.user.findUnique({
  where: { email: "a@mail.com" },
  include: { enrollments: { include: { course: true } } },
});
console.log(JSON.stringify(u, null, 2));
await prisma.$disconnect();
'

echo "=== sample courses ==="
npx tsx -e '
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const courses = await prisma.course.findMany({ where: { deletedAt: null }, take: 10, select: { id: true, code: true, isPublished: true } });
console.log(JSON.stringify(courses, null, 2));
await prisma.$disconnect();
'
