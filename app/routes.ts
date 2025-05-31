import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("/api/auth/*", "routes/api/auth.$.ts"),
  route("/auth/signin", "routes/auth/signin.tsx"),
  route("/auth/signup", "routes/auth/signup.tsx"),
] satisfies RouteConfig;
