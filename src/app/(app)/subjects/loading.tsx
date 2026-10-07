import { PageSkeleton } from "@/components/layout/PageSkeleton";

export default function SubjectLoading() {
  return <PageSkeleton kind="detail" back={{ href: "/home", label: "خانه" }} />;
}
