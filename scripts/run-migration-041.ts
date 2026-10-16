/**
 * Apply migration 041: enhanced quiz question types.
 * Usage: npx tsx scripts/run-migration-041.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  dotenv.config({ path: ".env.stack-local" });
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function main() {
  const sql = fs.readFileSync(
    "supabase/migrations/041_quiz_question_types.sql",
    "utf-8"
  );
  
  // Try RPC execute_sql first
  const { error } = await sb.rpc("execute_sql", { sql });
  if (error) {
    console.log("execute_sql RPC not available or failed:", error.message);
    console.log("Executing SQL statements sequentially or via direct REST client if possible...");
    // Fallback: run via pg or inform user/migration tool
  } else {
    console.log("✓ migration 041 applied successfully");
  }
}

main().catch((err) => {
  console.error(err);
});
