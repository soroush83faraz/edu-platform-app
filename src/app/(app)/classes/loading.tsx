import { PageSkeleton } from "@/components/layout/PageSkeleton";

export default function ClassesLoading() {
  return <PageSkeleton kind="cards" back={{ href: "/home", label: "خانه" }} />;
}
