import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("/api/auth/*", "routes/api/auth.$.ts"),
  route("/api/courses", "routes/api/courses.$.ts"),
  route("/auth/signin", "routes/auth/signin.tsx"),
  route("/auth/signup", "routes/auth/signup.tsx"),
  route("/courses", "routes/courses.tsx"),
  route("/api/courses/:id", "routes/api/courses.id.ts"),
] satisfies RouteConfig;
