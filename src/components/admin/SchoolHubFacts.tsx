/**
 * The school hub's header line: «کد · جنسیت · سال». The code is there only when the data carries it — the
 * organization admin's (`withSchoolCodeFor`); a principal's or vice principal's hub never receives it.
 */
export function SchoolHubFacts({ code, genderLabel, yearName }: { code?: string; genderLabel: string | null; yearName: string | null }) {
  const facts = [
    code ? (
      <bdi key="code" dir="ltr">
        {code}
      </bdi>
    ) : null,
    genderLabel,
    yearName,
  ].filter(Boolean);
  return (
    <span className="flex flex-wrap items-center gap-x-1.5">
      {facts.map((f, i) => (
        <span key={i}>
          {i > 0 ? <span aria-hidden className="text-text-faint"> · </span> : null}
          {f}
        </span>
      ))}
    </span>
  );
}
