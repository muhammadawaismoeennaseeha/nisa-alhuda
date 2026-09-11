-- ============================================================
-- Migration 016: Add is_ongoing flag + seed Tabseer ul Quran class
-- ============================================================
-- `is_ongoing` marks an already-running class that students can still join
-- mid-session. It renders a teal "On-going" badge on the catalog and
-- offering detail pages (visually distinct from the amber "New" badge).

ALTER TABLE offerings
  ADD COLUMN IF NOT EXISTS is_ongoing BOOLEAN NOT NULL DEFAULT false;

-- ─── Seed: Tabseer ul Quran ────────────────────────────────
-- A free, currently-running weekly Qur'an reflection session for females,
-- taught by Muallimah Sana Ahmed. Originally launched 25 April 2025 and
-- continues twice a week.
INSERT INTO offerings (
  title,
  slug,
  short_description,
  description,
  type,
  price,
  fee_type,
  mode,
  status,
  instructor_id,
  schedule_start,
  is_new,
  is_ongoing
)
-- INSERT ... SELECT rather than VALUES: the row materialises only when the
-- instructor profile actually exists. On a fresh database (local stack, CI, a
-- new environment) that profile has not been created yet, and a bare VALUES
-- insert aborted the whole migration on offerings_instructor_id_fkey.
SELECT
  'Tabseer ul Quran',
  'tabseer-ul-quran',
  'Soulful weekly sessions of Qur''an reflection with Muallimah Sana Ahmed. Free | Females Only.',
  E'خَيْرُكُمْ مَنْ تَعَلَّمَ الْقُرْآنَ وَعَلَّمَهُ\n"The best among you is the one who learns the Qur''an and teaches it." — Sahih al-Bukhari 5027\n\nJoin us for soulful sessions of Tabseer ul Quran — a reflective, heart-centred journey through the Book of Allah ﷻ. Each session opens a window into the meanings, wisdom, and guidance of the Qur''an, connecting its timeless message to the realities of our daily lives.\n\nGuided by Muallimah Sana Ahmed, these sessions are designed to nurture a living, breathing relationship with the Qur''an — where every verse becomes a mirror, every ayah a reminder, and every gathering a moment of stillness in a restless world.\n\n🕌 Class Details\n• Current Timings: Wednesday & Friday, 7:00 – 8:00 PM PKT\n• Mode: Online\n• Fee: FREE\n• Strictly For Females Only\n• Status: On-going — you can still join the journey\n\n👩‍🏫 Your Instructor: Muallimah Sana Ahmed\nA dedicated student and teacher of the Qur''an, Muallimah Sana brings warmth, clarity, and deep reverence to every session. Her approach blends traditional Tafsir with practical, heart-softening reflections to help each participant walk away with both knowledge and nearness to Allah ﷻ.\n\nPresented by Nisa AlHuda in collaboration with eMahad — An online Centre for Traditional Islamic Learning and Spiritual Sciences.\n\n🌐 www.emahad.org  |  www.tasawwuf.co  |  blog.emahad.org',
  'class',
  0,
  'one_time',
  'online',
  'published',
  '0b4f37d6-b1fe-4913-b22e-8134a65a7c7f',
  '2025-04-25',
  false,
  true
FROM profiles WHERE id = '0b4f37d6-b1fe-4913-b22e-8134a65a7c7f'
ON CONFLICT (slug) DO UPDATE SET
  short_description = EXCLUDED.short_description,
  description = EXCLUDED.description,
  type = EXCLUDED.type,
  price = EXCLUDED.price,
  fee_type = EXCLUDED.fee_type,
  mode = EXCLUDED.mode,
  status = EXCLUDED.status,
  instructor_id = EXCLUDED.instructor_id,
  schedule_start = EXCLUDED.schedule_start,
  is_new = EXCLUDED.is_new,
  is_ongoing = EXCLUDED.is_ongoing,
  updated_at = NOW();
