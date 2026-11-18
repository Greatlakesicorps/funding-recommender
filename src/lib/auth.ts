import { createInternalNeonAuth } from "@neondatabase/auth";

const authUrl = import.meta.env.VITE_NEON_AUTH_URL;

export const apiUrl = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

const neonAuth = authUrl ? createInternalNeonAuth(authUrl) : null;

export const authConfigured = neonAuth !== null;

export type SessionStatus = "signed-in" | "signed-out" | "unavailable";

export async function getSessionStatus(): Promise<SessionStatus> {
  if (!neonAuth) return "unavailable";
  try {
    const { data, error } = await neonAuth.adapter.getSession();
    if (error) return "unavailable";
    return data?.session ? "signed-in" : "signed-out";
  } catch {
    return "unavailable";
  }
}

/** Returns a fresh Neon Auth JWT for the Worker, or null when signed out. */
export async function getToken(): Promise<string | null> {
  if (!neonAuth) return null;
  try {
    return await neonAuth.getJWTToken();
  } catch {
    return null;
  }
}

function returnUrl(params = "") {
  return `${window.location.origin}${window.location.pathname}${params}`;
}

/** Resolves with an error message, or null when the redirect to Google started. */
export async function signInWithGoogle(): Promise<string | null> {
  if (!neonAuth) return "Sign-in is not configured for this site.";
  try {
    const result = await neonAuth.adapter.signIn.social({
      provider: "google",
      callbackURL: returnUrl(),
      errorCallbackURL: returnUrl("?error=signin"),
    });
    return result.error
      ? "We couldn’t start Google sign-in. Please try again."
      : null;
  } catch {
    return "We couldn’t connect to the sign-in service. Please try again.";
  }
}

export async function signOut(): Promise<void> {
  if (!neonAuth) return;
  const { error } = await neonAuth.adapter.signOut();
  if (error) throw error;
}
