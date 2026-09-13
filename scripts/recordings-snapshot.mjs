/**
 * Recordings safety net.
 *
 * Every class recording on Nisa lives in exactly one place: the
 * `recording_url` column of the `lessons` table. This script snapshots the
 * complete id -> recording_url map so any UI work can be proven non-destructive.
 *
 *   node scripts/recordings-snapshot.mjs            # write the baseline
 *   node scripts/recordings-snapshot.mjs --verify   # assert nothing changed
 *
 * The baseline lands in scripts/.recordings-baseline.json. --verify re-runs the
 * same read-only query and compares byte-for-byte against that file, exiting
 * non-zero (loudly) on any drift.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(HERE, ".recordings-baseline.json");
// Sidecar: on a DB where no lesson has a recording yet, an empty baseline map
// would still match after the lessons table was emptied. Pinning the total row
// count catches that.
const META_PATH = join(HERE, ".recordings-baseline.meta.json");

// Local stack only — these are Supabase's published local-dev keys.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error("✖ SUPABASE_SERVICE_ROLE_KEY missing — is .env.local active? (npm run env:local)");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Read-only. Selects only id + recording_url, sorted by id for a stable diff. */
async function snapshot() {
  const { data, error } = await supabase
    .from("lessons")
    .select("id, recording_url")
    .not("recording_url", "is", null)
    .order("id", { ascending: true });

  if (error) {
    console.error("✖ Query failed:", error.message);
    process.exit(1);
  }

  const map = {};
  for (const row of data) map[row.id] = row.recording_url;

  // Re-sort keys explicitly so JSON.stringify is deterministic.
  const sorted = {};
  for (const id of Object.keys(map).sort()) sorted[id] = map[id];
  return sorted;
}

/** Total lessons rows, regardless of recording_url. Read-only. */
async function lessonsTotal() {
  const { count, error } = await supabase
    .from("lessons")
    .select("*", { count: "exact", head: true });
  if (error) {
    console.error("✖ Lesson count failed:", error.message);
    process.exit(1);
  }
  return count ?? 0;
}

const verify = process.argv.includes("--verify");
const current = await snapshot();
const count = Object.keys(current).length;
const total = await lessonsTotal();
const serialized = JSON.stringify(current, null, 2) + "\n";

if (!verify) {
  writeFileSync(BASELINE_PATH, serialized);
  writeFileSync(META_PATH, JSON.stringify({ lessons_total: total }, null, 2) + "\n");
  console.log(serialized.trimEnd());
  console.log(`\n✔ Baseline written: ${BASELINE_PATH}`);
  console.log(`   Lessons with a recording_url: ${count}`);
  console.log(`   Lessons rows total:           ${total}`);
  process.exit(0);
}

// ── --verify ──
if (!existsSync(BASELINE_PATH)) {
  console.error(`✖ No baseline at ${BASELINE_PATH}. Run without --verify first.`);
  process.exit(1);
}

const baselineRaw = readFileSync(BASELINE_PATH, "utf8");
const baseline = JSON.parse(baselineRaw);
const baselineCount = Object.keys(baseline).length;

const baselineTotal = existsSync(META_PATH)
  ? JSON.parse(readFileSync(META_PATH, "utf8")).lessons_total
  : null;

if (serialized === baselineRaw && (baselineTotal === null || baselineTotal === total)) {
  console.log(`✔ RECORDINGS INTACT — ${count} recording_url values byte-identical to baseline.`);
  console.log(`  lessons rows: ${total} (baseline ${baselineTotal ?? "n/a"})`);
  process.exit(0);
}

// Anything below here is a failure. Be loud and specific.
console.error("\n" + "=".repeat(66));
console.error("🚨  RECORDINGS CHANGED — STOP. DO NOT PROCEED.");
console.error("=".repeat(66));
console.error(`   baseline: ${baselineCount} recordings, ${baselineTotal ?? "n/a"} lessons rows`);
console.error(`   current:  ${count} recordings, ${total} lessons rows\n`);

for (const id of Object.keys(baseline)) {
  if (!(id in current)) {
    console.error(`   ✖ LOST     ${id}  was: ${baseline[id]}`);
  } else if (current[id] !== baseline[id]) {
    console.error(`   ✖ CHANGED  ${id}`);
    console.error(`               was: ${baseline[id]}`);
    console.error(`               now: ${current[id]}`);
  }
}
for (const id of Object.keys(current)) {
  if (!(id in baseline)) {
    console.error(`   + ADDED    ${id}  -> ${current[id]}`);
  }
}
console.error("=".repeat(66) + "\n");
process.exit(1);
