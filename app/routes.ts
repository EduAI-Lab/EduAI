import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("/team", "routes/team.tsx"),
  route("/api/auth/*", "routes/api/auth.$.ts"),
  route("/api/courses", "routes/api/courses.$.ts"),
  route("/auth/login", "routes/auth/login.tsx"),
  route("/auth/register", "routes/auth/register.tsx"),
  route("/dashboard", "routes/dashboard.tsx"),
  route("/chat", "routes/chat.tsx"),
  route("/settings", "routes/settings.tsx"),
  route("/api/chat", "routes/api/chat.ts"),
  route("/api/chats/:chatId", "routes/api/chats.$chatId.ts"),
  route("/courses", "routes/courses.tsx"),
  route("/courses/:courseId", "routes/courses.$courseId.tsx"),
  route("/api/courses/:courseId/materials", "routes/api/courses.materials.$.ts"),
  route("/api/categories/:categoryId/topics", "routes/api/categories.topics.$.ts"), // Changed from courses.topics.$.ts to categories.topics.$.ts and the file name aswell.
  route("/api/courses/:id", "routes/api/courses.id.ts"),
  route("/admin/ai-models", "routes/admin.ai-models.tsx"),
  route("/admin/users", "routes/admin.users.tsx"),
  route("/api/ai-providers/*", "routes/api/ai-providers.$.ts"),
  route("/api/ai-models/*", "routes/api/ai-models.$.ts"),
  route("/api/users/*", "routes/api/users.$.ts"),
  route("/api/topics/*", "routes/api/topics.$.ts"),
  route("/api/ollama-models", "routes/api/ollama-models.ts"),
] satisfies RouteConfig;
