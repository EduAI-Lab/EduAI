/** Catch-all route (`*`). Inside the `_app.tsx` layout, so it keeps the shell. */
import { Link } from "react-router";
import { NotFoundState } from "@eduai/ui";

export default function NotFoundRoute() {
  return <NotFoundState LinkComponent={Link} />;
}
