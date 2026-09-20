// In-memory stand-in for Next's `cookies()` / `headers()` so Server Actions can be called directly in int tests.
// Register it in a test file with:
//   vi.mock("next/headers", () => import("./next-headers-mock").then((m) => m.nextHeadersMock));
// and drive it through `requestState`.
export interface SetCookieCall {
  name: string;
  value: string;
  options: Record<string, unknown> | undefined;
}

export const requestState = {
  cookies: new Map<string, string>(),
  headers: new Map<string, string>(),
  setCookieCalls: [] as SetCookieCall[],
  reset(): void {
    this.cookies.clear();
    this.headers.clear();
    this.setCookieCalls.length = 0;
  },
};

export const nextHeadersMock = {
  cookies: async () => ({
    get: (name: string) => (requestState.cookies.has(name) ? { name, value: requestState.cookies.get(name)! } : undefined),
    has: (name: string) => requestState.cookies.has(name),
    getAll: () => [...requestState.cookies.entries()].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      requestState.setCookieCalls.push({ name, value, options });
      if (options?.maxAge === 0 || value === "") requestState.cookies.delete(name);
      else requestState.cookies.set(name, value);
    },
    delete: (name: string) => {
      requestState.cookies.delete(name);
    },
  }),
  headers: async () => new Headers(Object.fromEntries(requestState.headers)),
};
