import { redirect } from "next/navigation";

/** `/` → `/home`; the (app) layout sends anonymous visitors on to /login. */
export default function RootPage() {
  redirect("/home");
}
