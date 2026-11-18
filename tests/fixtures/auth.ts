import { env } from "cloudflare:workers";
// The behavior suite simulates the auth outcomes at the app boundary.
export const auth = {
  getSession: async (options?: { query?: { disableCookieCache?: string } }) => {
    if (options?.query?.disableCookieCache !== "true")
      throw new Error("Live session validation required");
    const mode = (env as Cloudflare.Env & { TEST_AUTH_MODE?: string })
      .TEST_AUTH_MODE;
    if (mode === "signed-out") return { data: null, error: null };
    if (mode === "unavailable")
      return { data: null, error: new Error("Auth unavailable") };
    return { data: { user: { id: "test-user" } }, error: null };
  },
};
