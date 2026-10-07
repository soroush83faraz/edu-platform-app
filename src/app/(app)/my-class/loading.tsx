import { PageSkeleton } from "@/components/layout/PageSkeleton";

export default function MyClassLoading() {
  return <PageSkeleton kind="cards" back={{ href: "/home", label: "خانه" }} />;
}
