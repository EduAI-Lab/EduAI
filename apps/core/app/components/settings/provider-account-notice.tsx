import { IconInfoCircle } from "@tabler/icons-react";
import { Alert, AlertDescription } from "@eduai/ui";

/** Half-page guide on getting a provider key (#2063). */
export const PROVIDER_KEY_GUIDE_URL =
  "https://github.com/EduAI-Lab/EduAI/blob/development/docs/PROVIDER_API_KEY_GUIDE.md";

/**
 * Shown where someone starts adding a cloud provider key (#2062). Users without
 * an account at the provider got stuck partway through, so this says up front
 * that the account comes first and that the campus models need no key at all.
 */
export function ProviderAccountNotice({ className }: { className?: string }) {
  return (
    <Alert className={className}>
      <IconInfoCircle className="h-4 w-4" aria-hidden="true" />
      <AlertDescription>
        <p>
          <strong>You need an account with the provider first.</strong> Sign up with OpenAI, Google
          or OpenCode and create an API key there, then paste it here. A ChatGPT or Gemini app
          subscription is not an API key. You don't need a key for EduAI's campus models.
        </p>
        <a
          href={PROVIDER_KEY_GUIDE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block font-medium underline underline-offset-2"
        >
          How to get an API key
        </a>
      </AlertDescription>
    </Alert>
  );
}
