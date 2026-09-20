/** Centered single-card layout for the pre-app pages (login, forced password change). */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main className="flex flex-1 flex-col items-center justify-center bg-neutral-50 p-4">{children}</main>;
}
