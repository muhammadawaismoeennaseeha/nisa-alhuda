#!/usr/bin/env node
/**
 * Backend switcher.
 *
 *   npm run env:local     -> local Supabase stack (Docker)
 *   npm run env:hosted    -> hosted Supabase project
 *
 * Next.js only ever loads `.env.local`. Rather than hand-editing that file
 * every time you move between backends, keep one profile per backend and
 * copy the chosen one into place:
 *
 *   .env.stack-local    values from `supabase status`
 *   .env.stack-hosted   your hosted project keys
 *
 * All three files are gitignored; `.env.example` documents the shape.
 */
import { existsSync, copyFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROFILES = {
  local: ".env.stack-local",
  hosted: ".env.stack-hosted",
};

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SITE_URL",
];

const which = process.argv[2];
const from = PROFILES[which];

if (!from) {
  console.error(
    "Usage: node scripts/use-env.mjs <local|hosted>\n" +
      `  local   -> ${PROFILES.local}\n` +
      `  hosted  -> ${PROFILES.hosted}`
  );
  process.exit(1);
}

const src = resolve(process.cwd(), from);
const dest = resolve(process.cwd(), ".env.local");

if (!existsSync(src)) {
  console.error(
    `Missing profile: ${from}\n\n` +
      (which === "local"
        ? "Bring the stack up first, then copy its values in:\n" +
          "  npm run db:start\n" +
          "  supabase status -o env\n"
        : `Copy .env.example to ${from} and fill in your hosted project keys\n` +
          "(Supabase dashboard -> Project Settings -> API Keys).\n")
  );
  process.exit(1);
}

const body = readFileSync(src, "utf8");

// A half-filled profile is worse than a missing one: the app boots and then
// dies deep inside a Supabase call with an opaque error. Fail here instead.
const blank = REQUIRED.filter((key) => {
  const found = body.match(new RegExp("^" + key + "=(.*)$", "m"));
  return !found || !found[1].trim();
});

if (blank.length) {
  console.error(
    `${from} has no value for:\n` +
      blank.map((key) => "  " + key).join("\n") +
      "\n\nFill those in before switching. Shape is documented in .env.example."
  );
  process.exit(1);
}

copyFileSync(src, dest);

const url = (body.match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m) || [])[1] || "";

console.log(`Active backend: ${which}`);
console.log(`  ${from} -> .env.local`);
console.log(`  NEXT_PUBLIC_SUPABASE_URL=${url.trim()}`);
console.log("\nRestart the dev server for this to take effect.");
