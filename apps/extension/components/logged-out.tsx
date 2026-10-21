import { KeyRound, ScanText } from "lucide-react";
import { useState } from "react";
import { Button } from "@data-vault/ui";
import { browser } from "wxt/browser";
import { ensureServerAccess } from "../lib/permissions";

export function LoggedOut({ onSignedIn, capturePending = false }: { onSignedIn: () => void; capturePending?: boolean }) {
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState("");

  const signIn = async () => {
    setSigningIn(true);
    setError("");
    try {
      /**
       * Firefox asks for the address of the server before the extension may
       * reach it. The question has to be asked while the click is still
       * being handled, so it is asked here.
       */
      if (!await ensureServerAccess()) {
        throw new Error("DataVault needs permission to reach the server. Allow it for this site, then try again.");
      }
      const result = await browser.runtime.sendMessage({ action: "start-extension-auth" }) as { ok?: boolean; error?: string } | undefined;
      if (!result?.ok) throw new Error(result?.error ?? "Sign-in could not be completed. Please try again.");
      onSignedIn();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-in could not be completed. Please try again.");
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="flex min-h-72 flex-col items-center justify-center p-7 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-[#b8a4ed]">{capturePending ? <ScanText className="size-6" /> : <KeyRound className="size-6" />}</span>
      <h2 className="mt-5 text-xl font-semibold">{capturePending ? "Sign in to save" : "Connect DataVault"}</h2>
      <p className="mt-2 text-sm leading-6 text-[#6a6a6a]">
        {capturePending
          ? "Your selected text is waiting safely in this browser. Sign in, then check it and save."
          : "Sign in on the DataVault website. Your password never reaches the extension."}
      </p>
      {error ? <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      <Button className="mt-5 w-full" disabled={signingIn} onClick={() => void signIn()}>
        {signingIn ? "Opening sign in…" : capturePending ? "Sign in to save" : "Sign in"}
      </Button>
    </div>
  );
}
