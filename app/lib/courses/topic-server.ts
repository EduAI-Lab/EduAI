import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";
import { CreateTopicSchema, UpdateTopicSchema } from "./topic-schemas";

/**
 * Handles GET, POST for /api/topics
 * and PATCH, DELETE for /api/topics/:id
 */

export async function handleTopicRequest(request: Request) {
  const url = new URL(request.url);
  const pathSegments = url.pathname.split('/').filter(Boolean);
  const topicId = pathSegments[pathSegments.length - 1];

  switch (request.method) {
    case "GET": {
      // Get topics for a specific course
      const categoryId = url.searchParams.get('categoryId');
      
      if (!categoryId) {
        return new Response("category ID is required", { status: 400 });
      }

      const topics = await prisma.topic.findMany({
        where: { categoryId },
        orderBy: { order: 'asc' }
      });

      return new Response(JSON.stringify({ topics }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "POST": {
      const session = await auth.api.getSession(request);
      if (!session?.user) {
        return new Response("Unauthorized", { status: 401 });
      }

      const user = session.user;
      const body = await request.json();
      const result = CreateTopicSchema.safeParse(body);

      if (!result.success) {
        return new Response(
          JSON.stringify({
            error: "Invalid input",
            details: result.error.flatten(),
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // Check if user has access to this course
      const category = await prisma.courseCategory.findUnique({
        where: { id: result.data.categoryId },
        include: {
          course: { select: { professorId: true } },
        },
      });

      if (!category) {
        return new Response("Course not found", { status: 404 });
      }

      const isAdmin = user.role === "ADMIN";
      const isProfessor = user.role === "PROFESSOR" && user.id === category.course.professorId;

      if (!isAdmin && !isProfessor) {
        return new Response("Forbidden", { status: 403 });
      }

      const topic = await prisma.topic.create({
        data: result.data,
      });

      return new Response(JSON.stringify(topic), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "PATCH": {
      if (!topicId) {
        return new Response("Topic ID is required", { status: 400 });
      }

      const session = await auth.api.getSession(request);
      if (!session?.user) {
        return new Response("Unauthorized", { status: 401 });
      }

      const user = session.user;
      const body = await request.json();
      const result = UpdateTopicSchema.safeParse(body);

      if (!result.success) {
        return new Response(
          JSON.stringify({
            error: "Invalid input",
            details: result.error.flatten(),
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // Check if user has access to this topic's course
      const topic = await prisma.topic.findUnique({
        where: { id: topicId },
        include: { category: { select: { course: { select: { professorId: true } } } } }
      });

      if (!topic) {
        return new Response("Topic not found", { status: 404 });
      }

      const isAdmin = user.role === "ADMIN";
      const isProfessor = user.role === "PROFESSOR" && user.id === topic.category.course.professorId;

      if (!isAdmin && !isProfessor) {
        return new Response("Forbidden", { status: 403 });
      }

      const updated = await prisma.topic.update({
        where: { id: topicId },
        data: result.data,
      });

      return new Response(JSON.stringify(updated), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "DELETE": {
      if (!topicId) {
        return new Response("Topic ID is required", { status: 400 });
      }

      const session = await auth.api.getSession(request);
      if (!session?.user) {
        return new Response("Unauthorized", { status: 401 });
      }

      const user = session.user;

      // Check if user has access to this topic's course
      const topic = await prisma.topic.findUnique({
        where: { id: topicId },
        include: { category: { select: { course: { select: { professorId: true } } } } }
      });

      if (!topic) {
        return new Response("Topic not found", { status: 404 });
      }

      const isAdmin = user.role === "ADMIN";
      const isProfessor = user.role === "PROFESSOR" && user.id === topic.category.course.professorId;

      if (!isAdmin && !isProfessor) {
        return new Response("Forbidden", { status: 403 });
      }

      await prisma.topic.delete({
        where: { id: topicId },
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    default:
      return new Response("Method not allowed", { status: 405 });
  }
}
