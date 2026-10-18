/**
 * One field of the dark auth door (`.auth-field`, src/app/globals.css «درِ تیره»): the label above, then the field —
 * a leading glyph, the bare input (`children`), an optional trailing button (the eye) — and its error below. The
 * focus ring is the field's (`:focus-within`), so the input inside draws none. Used by the login and password forms
 * only; the app behind the door keeps `Input`.
 */
export function AuthField({
  id,
  label,
  icon,
  error,
  errorId,
  trailing,
  children,
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
  error?: string;
  errorId: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="px-0.5 text-meta font-semibold text-(--auth-muted)">
        {label}
      </label>
      <div className="auth-field" data-invalid={error ? "" : undefined}>
        {icon}
        {children}
        {trailing}
      </div>
      {error ? (
        <p id={errorId} className="text-sm text-(--auth-danger)">
          {error}
        </p>
      ) : null}
    </div>
  );
}
