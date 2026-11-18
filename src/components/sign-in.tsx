import { useState } from "react";
import { signInWithGoogle } from "@/lib/auth";

type SignInProps = {
  /** Shown above the button, e.g. when the session service is unreachable. */
  notice?: string;
};

export function SignIn({ notice }: SignInProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const callbackError = new URLSearchParams(window.location.search).has(
    "error",
  );

  async function signIn() {
    setPending(true);
    setError("");
    const message = await signInWithGoogle();
    if (message) {
      setError(message);
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
        {(error || notice || callbackError) && (
          <p role="alert">
            {error ||
              notice ||
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
