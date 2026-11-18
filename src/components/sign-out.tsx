import { useState } from "react";
import { signOut } from "@/lib/auth";

export function SignOut() {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function handleSignOut() {
    setPending(true);
    setFailed(false);
    try {
      await signOut();
      // Reload so no signed-in state survives in memory.
      window.location.reload();
    } catch {
      setFailed(true);
      setPending(false);
    }
  }
  return (
    <span className="sign-out">
      <button type="button" onClick={handleSignOut} disabled={pending}>
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {failed && <span role="alert">Could not sign out. Try again.</span>}
    </span>
  );
}
