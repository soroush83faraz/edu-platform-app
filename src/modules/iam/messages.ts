/** User-facing Persian strings of the iam module (kept out of "use server" files, which may only export functions). */
export const LOGIN_GENERIC_MESSAGE = "شماره یا رمز اشتباه است.";
export const NO_MEMBERSHIP_MESSAGE = "حساب شما به هیچ مدرسه‌ای متصل نیست.";
/** `/login?out=1` after a logout. */
export const LOGGED_OUT_MESSAGE = "خارج شدید.";
/** Voluntary «تغییر رمز»: the current password is required and verified. */
export const CURRENT_PASSWORD_REQUIRED_MESSAGE = "رمز فعلی را وارد کنید.";
/** One message for a wrong current password AND for a throttled account (no hint which). */
export const CURRENT_PASSWORD_WRONG_MESSAGE = "رمز فعلی اشتباه است.";
/**
 * A person removed by «حذف دانش‌آموز» / «حذف از کارکنان» (src/modules/iam/removal.ts): every path that would give them
 * a login, a class or a teaching again refuses with this (reset, unlock, new account, enrollment, teacher assignment).
 */
export const PERSON_REMOVED_MESSAGE = "این شخص حذف شده است.";
