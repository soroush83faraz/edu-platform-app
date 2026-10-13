import { PageSkeleton } from "@/components/layout/PageSkeleton";

/** The pages under /counseling go back to different parents (Home, «مشاوره»), so the pill is the stand-in until the page's own arrives. */
export default function CounselingLoading() {
  return <PageSkeleton kind="list" />;
}
