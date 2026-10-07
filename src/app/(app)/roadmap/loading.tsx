import { PageSkeleton } from "@/components/layout/PageSkeleton";

export default function RoadmapLoading() {
  return <PageSkeleton kind="cards" back={{ href: "/home", label: "خانه" }} />;
}
