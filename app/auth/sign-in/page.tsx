"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth/client";

export default function SignIn() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const callbackError = useSearchParams().has("error");
  async function signIn() {
    setPending(true);
    setError("");
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: "/",
        errorCallbackURL: "/auth/sign-in?error=signin",
      });
      if (result.error)
        setError("We couldn’t start Google sign-in. Please try again.");
    } catch {
      setError("We couldn’t connect to the sign-in service. Please try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="sign-in-page">
      <section className="sign-in-card">
        <span className="guide-eyebrow">GREAT LAKES I-CORPS HUB</span>
        <h1>Welcome to Funding Explorer</h1>
        <p>Sign in to explore funding and support for your team.</p>
        <button type="button" onClick={signIn} disabled={pending}>
          {pending ? "Opening Google sign-in…" : "Continue with Google"}
        </button>
        {(error || callbackError) && (
          <p role="alert">
            {error ||
              "Sign-in was cancelled or could not be completed. Please try again."}
          </p>
        )}
        <p className="sign-in-note">
          You’ll return to Funding Explorer after signing in. Use fictional or
          public information while this prototype is being tested.
        </p>
      </section>
    </main>
  );
}
