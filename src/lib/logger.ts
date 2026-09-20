import pino from "pino";

const level = process.env.LOG_LEVEL ?? "info";
const isDev = process.env.NODE_ENV !== "production";

/**
 * Structured logger. JSON in production (Docker json-file driver), pretty in dev.
 * Sensitive fields are redacted — never log raw request bodies or cookies.
 */
export const logger = pino({
  level,
  base: { version: process.env.APP_VERSION ?? "dev" },
  redact: {
    paths: [
      "req.headers.cookie",
      "req.headers.authorization",
      "*.cookie",
      "*.authorization",
      "*.password",
      "*.newPassword",
      "*.currentPassword",
      "*.token",
      "*.phone",
      "*.phone_e164",
      "password",
      "token",
      "phone",
    ],
    censor: "[redacted]",
  },
  ...(isDev
    ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" } } }
    : {}),
});

export type Logger = typeof logger;
