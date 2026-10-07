import { PageSkeleton } from "@/components/layout/PageSkeleton";

export default function NewWorkItemLoading() {
  return <PageSkeleton kind="detail" back={{ href: "/inbox", label: "پنل من" }} />;
}
