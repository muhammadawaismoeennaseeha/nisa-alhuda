/**
 * Single source of truth for the end-to-end admin login.
 *
 * The password used to live as a plaintext literal in every spec (a real,
 * committed credential — a standing security exposure). It now comes from the
 * environment. The defaults below are LOCAL-ONLY dummies: scripts/seed-e2e-user.ts
 * seeds this exact account into a fresh local database, so
 * `npm run seed:e2e && npm run test:e2e` works with no extra setup.
 *
 * For any hosted or CI run, set E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD (and
 * optionally E2E_ADMIN_FULL_NAME) in the environment to override. Never commit
 * a real password here.
 *
 * These are getters (not eval-time constants) so a caller that loads an
 * environment file first — like the seed script's dotenv step — reads them
 * after that load has populated the environment, not before it.
 */
export const e2eAdminEmail = (): string =>
  process.env.E2E_ADMIN_EMAIL ?? "e2e-admin@nisa.local";

export const e2eAdminPassword = (): string =>
  process.env.E2E_ADMIN_PASSWORD ?? "e2e-local-admin-pw";

export const e2eAdminFullName = (): string =>
  process.env.E2E_ADMIN_FULL_NAME ?? "E2E Admin";
