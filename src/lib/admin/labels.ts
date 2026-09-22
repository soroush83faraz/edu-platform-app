// Pure Persian labels shared by server and client admin components (no server-only imports here).
const ROLE_LABELS: Record<string, string> = {
  org_admin: "مدیر سازمان",
  school_principal: "مدیر مدرسه",
  vice_principal: "معاون",
  teacher: "دبیر",
  student: "دانش‌آموز",
  guardian_full: "ولی",
};

export const roleLabel = (code: string): string => ROLE_LABELS[code] ?? code;
