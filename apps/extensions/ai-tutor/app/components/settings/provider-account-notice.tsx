import { IconInfoCircle } from "@tabler/icons-react";
import { Alert, AlertDescription } from "@eduai/ui";

/** Half-page guide on getting a provider key (#2063). Core's notice links the same page. */
export const PROVIDER_KEY_GUIDE_URL =
  "https://github.com/EduAI-Lab/EduAI/blob/development/docs/PROVIDER_API_KEY_GUIDE.md";

/** Link to the provider key guide, opened in a new tab. */
export function ProviderKeyGuideLink({ className }: { className?: string }) {
  return (
    <a
      href={PROVIDER_KEY_GUIDE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={className ?? "font-medium underline underline-offset-2"}
    >
      How to get an API key
    </a>
  );
}

/**
 * Shown where someone starts adding a provider key (#2062). Students without
 * an account at the provider got stuck partway through, so this says up front
 * that the account comes first.
 */
export function ProviderAccountNotice({ className }: { className?: string }) {
  return (
    <Alert className={className}>
      <IconInfoCircle className="h-4 w-4" aria-hidden="true" />
      <AlertDescription>
        <p>
          <strong>You need an account with the provider first.</strong> Sign up with OpenAI, Google
          or OpenCode and create an API key there, then paste it here. A ChatGPT or Gemini app
          subscription is not an API key.
        </p>
        <ProviderKeyGuideLink className="mt-1 inline-block font-medium underline underline-offset-2" />
      </AlertDescription>
    </Alert>
  );
}
