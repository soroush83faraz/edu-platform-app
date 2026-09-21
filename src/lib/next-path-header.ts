// The request header through which src/proxy.ts hands the requested page (path + query, `safeNextPath`-checked)
// to the (app)/(admin) layouts, so a present-but-dead session cookie redirects to `/login?next=<page>` exactly like
// the proxy's cookie-less redirect does. Import-free: the proxy runs on the edge runtime.
export const NEXT_PATH_HEADER = "x-next-path";
