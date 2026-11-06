import { Button } from "@data-vault/ui";
import { WEB_URL } from "../lib/api";
import { describeAiFailure } from "../lib/ai";

/**
 * A one-line summary of the free AI allowance.
 *
 * The words are deliberately plain. A user should never have to think about
 * a rate limit to understand why a button is greyed out.
 */
export function AiCreditStrip() {
  return null;
}

/**
 * The consent prompt, shown before anything is sent to the model provider.
 *
 * On the free tier, submitted content may be used to improve Google's
 * products, so the agreement is explicit and it happens here, in the place
 * where the request is actually made.
 */
export function AiConsentPrompt({ onAgreed, onDeclined }: { onAgreed: () => void; onDeclined: () => void }) {
  return (
    <div className="m-4 rounded-2xl bg-soft p-4 text-sm">
      <h2 className="font-semibold">Send content to Google?</h2>
      <p className="mt-2 text-xs leading-5 text-strong">
        AI features send the text you choose to Google&apos;s Gemini model. The free tier we use may allow Google to use that content to improve their products.
      </p>
      <p className="mt-2 text-xs leading-5 text-strong">
        We send only the text you ask about, never your whole library.
      </p>
      <div className="mt-4 flex gap-2">
        <Button size="sm" onClick={onAgreed}>Agree</Button>
        <Button size="sm" variant="ghost" onClick={onDeclined}>Not now</Button>
      </div>
    </div>
  );
}

/** A short, plain explanation of why an AI action could not run. */
export function AiErrorNote({ message, onOpenWebsite }: { message: string; onOpenWebsite: boolean }) {
  return (
    <div className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <p>{message}</p>
      {onOpenWebsite ? (
        <button
          type="button"
          className="mt-2 font-semibold underline"
          onClick={() => void chrome.tabs.create({ url: `${WEB_URL}/settings` })}
        >
          Open DataVault
        </button>
      ) : null}
    </div>
  );
}

export { describeAiFailure };
