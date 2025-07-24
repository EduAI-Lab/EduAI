import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("/api/auth/*", "routes/api/auth.$.ts"),
  route("/api/courses", "routes/api/courses.$.ts"),
  route("/auth/login", "routes/auth/login.tsx"),
  route("/auth/register", "routes/auth/register.tsx"),
  route("/dashboard", "routes/dashboard.tsx"),
  route("/chat", "routes/chat.tsx"),
  route("/api/chat", "routes/api/chat.ts"),
  route("/courses", "routes/courses.tsx"),
  route("/api/courses/:id", "routes/api/courses.id.ts"),
  route("/admin/ai-models", "routes/admin.ai-models.tsx"),
  route("/admin/users", "routes/admin.users.tsx"),
  route("/api/ai-providers/*", "routes/api/ai-providers.$.ts"),
  route("/api/ai-models/*", "routes/api/ai-models.$.ts"),
  route("/api/users/*", "routes/api/users.$.ts"),
] satisfies RouteConfig;
