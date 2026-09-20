import { AppError, type ErrorCode } from "./AppError";

/** Default Persian messages per error code. Actions may pass a more specific message. */
export const FA_MESSAGES: Record<ErrorCode, string> = {
  NOT_FOUND: "موردی یافت نشد.",
  FORBIDDEN: "شما اجازهٴ انجام این کار را ندارید.",
  UNAUTHENTICATED: "برای ادامه وارد حساب خود شوید.",
  VALIDATION: "اطلاعات واردشده معتبر نیست.",
  CONFLICT: "این مورد قبلاً ثبت شده یا با دادهٴ دیگری تداخل دارد.",
  RATE_LIMITED: "تعداد درخواست‌ها بیش از حد است. لطفاً کمی بعد دوباره تلاش کنید.",
  INTERNAL: "خطایی رخ داد. لطفاً دوباره تلاش کنید.",
};

export function appError(code: ErrorCode, message?: string, details?: unknown): AppError {
  return new AppError(code, message ?? FA_MESSAGES[code], details);
}

export const notFound = (msg?: string) => appError("NOT_FOUND", msg);
export const forbidden = (msg?: string) => appError("FORBIDDEN", msg);
export const unauthenticated = (msg?: string) => appError("UNAUTHENTICATED", msg);
export const validation = (details?: unknown, msg?: string) => appError("VALIDATION", msg, details);
export const conflict = (msg?: string) => appError("CONFLICT", msg);
export const rateLimited = (msg?: string) => appError("RATE_LIMITED", msg);
export const internal = (msg?: string) => appError("INTERNAL", msg);
