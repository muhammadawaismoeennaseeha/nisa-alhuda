-- ============================================================
-- Migration 037: Teaching Assistant role (enum value only)
-- ============================================================
-- Adds a `ta` value to the user_role enum. A TA is a scoped instructor:
-- everything an instructor can do (attendance, grades, content), but only
-- on the courses they are explicitly assigned to (see migration 038), and
-- never anything financial.
--
-- Like migration 018 (treasurer), this migration ONLY adds the enum value.
-- Postgres forbids using a newly-added enum value in the same transaction
-- that adds it, so every policy/function that references 'ta' lives in a
-- LATER migration (038+). Keep this file to the single ALTER.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'ta';
