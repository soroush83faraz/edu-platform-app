// The global Zod error map (src/lib/errors/zod-fa.ts): every default Zod message that used to leak into field errors
// («Too small: expected number to be >=1», «Invalid input: expected number, received string») is Persian now, and a
// schema's own message still wins. Pure: no database.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import "@/lib/errors";

const first = (r: z.ZodSafeParseResult<unknown>): string => (r.success ? "" : r.error.issues[0]!.message);
const latin = /[A-Za-z]/;

describe("Zod v4 Persian error map", () => {
  it("invalid_type for number / string / boolean, missing values", () => {
    expect(first(z.number().safeParse("abc"))).toBe("مقدار باید عدد باشد.");
    expect(first(z.number().safeParse(undefined))).toBe("این فیلد را وارد کنید.");
    expect(first(z.string().safeParse(12))).toBe("مقدار باید متن باشد.");
    expect(first(z.boolean().safeParse("yes"))).toBe("مقدار باید بله یا خیر باشد.");
    expect(first(z.object({ a: z.string() }).safeParse({}))).toBe("این فیلد را وارد کنید.");
  });

  it("too_small / too_big for numbers, strings and arrays (Persian digits, no Latin)", () => {
    expect(first(z.number().min(1).safeParse(0))).toBe("مقدار نباید کمتر از ۱ باشد.");
    expect(first(z.number().max(40).safeParse(41))).toBe("مقدار نباید بیشتر از ۴۰ باشد.");
    expect(first(z.number().gt(0).safeParse(0))).toBe("مقدار باید بیشتر از ۰ باشد.");
    expect(first(z.string().min(1).safeParse(""))).toBe("این فیلد را وارد کنید.");
    expect(first(z.string().min(3).safeParse("ab"))).toBe("دست‌کم ۳ نویسه لازم است.");
    expect(first(z.string().max(5).safeParse("abcdef"))).toBe("حداکثر ۵ نویسه مجاز است.");
    expect(first(z.array(z.string()).min(1).safeParse([]))).toBe("دست‌کم ۱ مورد لازم است.");
    expect(first(z.number().int().safeParse(1.5))).toBe("مقدار باید عدد صحیح باشد.");
  });

  it("enum, uuid, unknown keys — and a schema's own message wins", () => {
    expect(first(z.enum(["a", "b"]).safeParse("c"))).toBe("گزینهٴ انتخاب‌شده معتبر نیست.");
    expect(first(z.uuid().safeParse("nope"))).toBe("شناسه نامعتبر است.");
    expect(first(z.object({}).strict().safeParse({ x: 1 }))).toBe("فیلد ناشناخته در ورودی.");
    expect(first(z.number("ظرفیت باید عدد باشد.").safeParse("x"))).toBe("ظرفیت باید عدد باشد.");
    for (const r of [z.number().min(1).safeParse("x"), z.string().safeParse(null), z.date().safeParse("x"), z.number().multipleOf(2).safeParse(3)]) {
      expect(first(r)).not.toMatch(latin);
    }
  });
});
