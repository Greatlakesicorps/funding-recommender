"use client";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";

export function SignOut() {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function signOut() {
    setPending(true);
    setFailed(false);
    try {
      const { error } = await authClient.signOut();
      if (error) throw error;
      // Discard all client-side state and rerun middleware after sign-out.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/auth/sign-in");
    } catch {
      setFailed(true);
      setPending(false);
    }
  }
  return (
    <span className="sign-out">
      <button type="button" onClick={signOut} disabled={pending}>
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {failed && <span role="alert">Could not sign out. Try again.</span>}
    </span>
  );
}
