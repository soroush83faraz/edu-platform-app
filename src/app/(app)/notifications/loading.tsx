import { PageSkeleton } from "@/components/layout/PageSkeleton";

export default function NotificationsLoading() {
  return <PageSkeleton kind="list" back={{ href: "/home", label: "خانه" }} />;
}
