import { handleTopicRequest } from "~/lib/courses/topic-server";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  return handleTopicRequest(request);
}

export async function action({ request }: ActionFunctionArgs) {
  return handleTopicRequest(request);
}
  