"use strict";
// Passenger startup file for the cPanel Application Manager (Application Startup File = app.js).
// Plain CommonJS, no dependencies, Node 22 (/opt/cpanel/ea-nodejs22/bin/node).
//
// Layout it expects, all relative to this file (the cPanel "Application Root"):
//   app.js                       <- this file (uploaded once, by hand)
//   current.txt                  <- one line: the release folder name to serve
//   tmp/restart.txt              <- touch it to make Passenger restart the app
//   releases/<name>/server.js    <- a Next.js standalone server produced by scripts/package-release.mjs
//
// It only picks a release and hands over; it never touches the database and runs no migration.

const fs = require("node:fs");
const path = require("node:path");

const APP_ROOT = __dirname;
const CURRENT_FILE = path.join(APP_ROOT, "current.txt");

/** Fail loudly: the message goes to stderr (Passenger error page / stderr.log) and then kills the boot. */
function fail(message) {
  const line = `[app.js] FATAL: ${message}`;
  console.error(line);
  throw new Error(line);
}

let release;
try {
  release = fs.readFileSync(CURRENT_FILE, "utf8").trim();
} catch (err) {
  fail(`cannot read ${CURRENT_FILE} (${err.code || err.message}). Create it with a single line holding the release folder name, e.g. 20260922T140510Z-b354260`);
}

if (!release) fail(`${CURRENT_FILE} is empty. It must hold exactly one release folder name.`);

// Guard against path traversal and stray characters — the name is a plain folder name under releases/.
if (!/^[A-Za-z0-9._-]+$/.test(release)) {
  fail(`invalid release name ${JSON.stringify(release)} in current.txt. Allowed characters: A-Z a-z 0-9 . _ -`);
}

const entry = path.join(APP_ROOT, "releases", release, "server.js");
if (!fs.existsSync(entry)) {
  fail(`release "${release}" is not deployed: ${entry} does not exist. Check releases/ and fix current.txt.`);
}

// Passenger does not always set NODE_ENV; the standalone server.js sets it too, but the value must be right
// before any module of the release is evaluated.
if (!process.env.NODE_ENV) process.env.NODE_ENV = "production";

console.error(`[app.js] starting release ${release} (APP_VERSION=${process.env.APP_VERSION || "unset"}, node ${process.version})`);

// Hand over. server.js does process.chdir(__dirname) and listens on process.env.PORT, which Passenger provides.
require(entry);
