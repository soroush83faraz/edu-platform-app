import { PageSkeleton } from "@/components/layout/PageSkeleton";

/** Every guardian page (`/child/*`) leads back to Home (with the child selected — the page's own pill replaces this one). */
export default function ChildLoading() {
  return <PageSkeleton kind="list" back={{ href: "/home", label: "خانه" }} />;
}
