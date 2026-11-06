import { WEB_URL } from "../lib/api";
import { describeAiFailure } from "../lib/ai";

/** A short explanation of why an AI action could not run. */
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
          Open DataVault Settings
        </button>
      ) : null}
    </div>
  );
}

export { describeAiFailure };
