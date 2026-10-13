import { PageSkeleton } from "@/components/layout/PageSkeleton";

/** Every page under /report-card has a different parent, so the pill is the stand-in until the page's own arrives. */
export default function ReportCardLoading() {
  return <PageSkeleton kind="list" />;
}
