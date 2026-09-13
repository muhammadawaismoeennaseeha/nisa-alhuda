/**
 * The recordings constraint, pinned.
 *
 * `lessons.recording_url` is the only copy of a class recording that exists
 * anywhere in Nisa. Two screens now write lessons — the instructor subject page
 * and the admin course workspace — and both save through
 * `src/lib/course-structure.ts`.
 *
 * These tests exercise the real update path against a fake Supabase that
 * actually applies each patch to a stored row, so "unchanged" means the stored
 * string is byte-identical afterwards, not merely that the payload looked
 * right.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildLessonInsert,
  buildLessonUpdatePatch,
  buildSubjectUpdatePatch,
  createLesson,
  deleteLesson,
  diffLesson,
  hasRecording,
  moveInOrder,
  persistOrder,
  slugify,
  uniqueSubjectSlug,
  updateLesson,
} from "@/lib/course-structure";
import type { Lesson } from "@/lib/types/database";

const RECORDING = "https://drive.google.com/file/d/1AbC_dEfG-h/view?usp=sharing";

function lesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: "les-1",
    offering_id: "off-1",
    subject_id: "sub-1",
    title: "Tahara — Purification",
    description: "Ritual purity, in detail.",
    scheduled_at: "2026-01-12T13:00:00Z",
    live_class_link: null,
    recording_url: RECORDING,
    sort_order: 0,
    is_published: true,
    created_at: "2025-12-01T00:00:00Z",
    updated_at: "2025-12-01T00:00:00Z",
    ...overrides,
  };
}

interface Statement {
  table: string;
  op: "update" | "insert" | "delete";
  payload?: Record<string, unknown>;
  id?: string;
}

/**
 * A Supabase stand-in that keeps rows in memory and applies patches to them,
 * recording every statement it was asked to run.
 */
function fakeSupabase(rows: Lesson[] = []) {
  const store = new Map(rows.map((r) => [r.id, { ...r }]));
  const statements: Statement[] = [];

  const client = {
    from(table: string) {
      return {
        update(payload: Record<string, unknown>) {
          return {
            async eq(_column: string, id: string) {
              statements.push({ table, op: "update", payload, id });
              const row = store.get(id);
              if (row) Object.assign(row, payload);
              return { error: null };
            },
          };
        },
        insert(payload: Record<string, unknown>) {
          return {
            select() {
              return {
                async single() {
                  statements.push({ table, op: "insert", payload });
                  const row = { id: `new-${store.size + 1}`, ...payload };
                  store.set(row.id as string, row as unknown as Lesson);
                  return { data: row, error: null };
                },
              };
            },
          };
        },
        delete() {
          return {
            async eq(_column: string, id: string) {
              statements.push({ table, op: "delete", id });
              if (table === "lessons") store.delete(id);
              return { error: null };
            },
          };
        },
      };
    },
  };

  return {
    client: client as unknown as SupabaseClient,
    statements,
    row: (id: string) => store.get(id),
  };
}

describe("buildLessonUpdatePatch", () => {
  it("omits recording_url entirely when the caller does not pass it", () => {
    const patch = buildLessonUpdatePatch({ title: "Renamed" });

    expect(patch).toEqual({ title: "Renamed" });
    expect("recording_url" in patch).toBe(false);
  });

  it("treats an explicit undefined as untouched, not as a clear", () => {
    const patch = buildLessonUpdatePatch({
      title: "Renamed",
      recording_url: undefined,
    });

    expect("recording_url" in patch).toBe(false);
  });

  it("still lets a caller that owns the field set or clear it", () => {
    expect(buildLessonUpdatePatch({ recording_url: RECORDING })).toEqual({
      recording_url: RECORDING,
    });
    expect(buildLessonUpdatePatch({ recording_url: null })).toEqual({
      recording_url: null,
    });
  });

  it("drops columns outside the writable allowlist", () => {
    const whole = lesson();
    const patch = buildLessonUpdatePatch(whole as never);

    expect(patch).not.toHaveProperty("id");
    expect(patch).not.toHaveProperty("created_at");
    expect(patch).not.toHaveProperty("updated_at");
  });
});

describe("diffLesson", () => {
  it("emits only the changed column when a title is edited", () => {
    const current = lesson();

    const patch = diffLesson(current, {
      title: "Tahara — Purification (revised)",
      description: current.description,
      scheduled_at: current.scheduled_at,
      live_class_link: current.live_class_link,
      is_published: current.is_published,
    });

    expect(patch).toEqual({ title: "Tahara — Purification (revised)" });
    expect("recording_url" in patch).toBe(false);
  });

  it("drops a re-sent recording_url that matches what is stored", () => {
    const current = lesson();

    const patch = diffLesson(current, {
      title: "New title",
      recording_url: RECORDING,
    });

    expect(patch).toEqual({ title: "New title" });
  });
});

describe("updateLesson — the recordings guarantee", () => {
  it("leaves recording_url byte-identical when only the title changes", async () => {
    const db = fakeSupabase([lesson()]);
    const before = db.row("les-1")!.recording_url;

    await updateLesson(db.client, "les-1", { title: "Renamed by an admin" });

    const after = db.row("les-1")!;
    expect(after.title).toBe("Renamed by an admin");
    expect(after.recording_url).toBe(before);
    expect(after.recording_url).toBe(RECORDING);
    // Byte-for-byte, not just equal-ish.
    expect([...after.recording_url!]).toEqual([...RECORDING]);
    // And the statement never named the column at all.
    expect(db.statements[0].payload).not.toHaveProperty("recording_url");
  });

  it("leaves recording_url byte-identical when title and description change", async () => {
    const db = fakeSupabase([lesson()]);

    await updateLesson(
      db.client,
      "les-1",
      diffLesson(db.row("les-1")!, {
        title: "Tahara, part one",
        description: "Rewritten summary.",
      })
    );

    const after = db.row("les-1")!;
    expect(after.title).toBe("Tahara, part one");
    expect(after.description).toBe("Rewritten summary.");
    expect(after.recording_url).toBe(RECORDING);
  });

  it("leaves recording_url alone when a lesson is published or hidden", async () => {
    const db = fakeSupabase([lesson({ is_published: false })]);

    await updateLesson(db.client, "les-1", { is_published: true });

    expect(db.row("les-1")!.is_published).toBe(true);
    expect(db.row("les-1")!.recording_url).toBe(RECORDING);
    expect(db.statements[0].payload).toEqual({ is_published: true });
  });

  it("leaves recording_url alone when a lesson is reordered", async () => {
    const db = fakeSupabase([
      lesson({ id: "a", sort_order: 0 }),
      lesson({ id: "b", sort_order: 1, recording_url: null }),
    ]);

    await persistOrder(db.client, "lessons", ["b", "a"]);

    expect(db.row("a")!.sort_order).toBe(1);
    expect(db.row("a")!.recording_url).toBe(RECORDING);
    for (const s of db.statements) {
      expect(s.payload).not.toHaveProperty("recording_url");
    }
  });

  it("cannot be tricked into a full-row write that drops the column", async () => {
    const db = fakeSupabase([lesson()]);
    // A caller spreading a row it loaded before the recording existed. The
    // allowlist copies only writable columns, and `recording_url` is simply
    // absent from this object, so it stays absent from the statement.
    const staleRow = {
      title: "From a stale copy",
      description: null,
      scheduled_at: null,
      live_class_link: null,
      is_published: false,
      sort_order: 3,
    };

    await updateLesson(db.client, "les-1", staleRow);

    expect(db.row("les-1")!.recording_url).toBe(RECORDING);
  });

  it("issues no statement at all for an empty patch", async () => {
    const db = fakeSupabase([lesson()]);

    await updateLesson(db.client, "les-1", diffLesson(db.row("les-1")!, {}));

    expect(db.statements).toHaveLength(0);
    expect(db.row("les-1")!.recording_url).toBe(RECORDING);
  });
});

describe("createLesson", () => {
  it("defaults a new lesson's recording_url to null rather than omitting it", async () => {
    const db = fakeSupabase();

    await createLesson(db.client, {
      offering_id: "off-1",
      subject_id: "sub-1",
      title: "New class",
      sort_order: 0,
    });

    expect(db.statements[0].payload).toMatchObject({
      recording_url: null,
      is_published: false,
    });
  });

  it("keeps a recording_url supplied on create", () => {
    expect(
      buildLessonInsert({
        offering_id: "off-1",
        subject_id: null,
        title: "Backfilled class",
        sort_order: 2,
        recording_url: RECORDING,
      }).recording_url
    ).toBe(RECORDING);
  });
});

describe("deleteLesson", () => {
  it("removes the lesson's resources before the lesson itself", async () => {
    const db = fakeSupabase([lesson()]);

    await deleteLesson(db.client, "les-1");

    expect(db.statements.map((s) => `${s.op}:${s.table}`)).toEqual([
      "delete:resources",
      "delete:lessons",
    ]);
    expect(db.row("les-1")).toBeUndefined();
  });
});

describe("hasRecording", () => {
  it("ignores a blank or whitespace-only URL", () => {
    expect(hasRecording({ recording_url: null })).toBe(false);
    expect(hasRecording({ recording_url: "" })).toBe(false);
    expect(hasRecording({ recording_url: "   " })).toBe(false);
    expect(hasRecording({ recording_url: RECORDING })).toBe(true);
  });
});

describe("buildSubjectUpdatePatch", () => {
  it("allowlists columns and skips undefined", () => {
    const patch = buildSubjectUpdatePatch({
      title: "Fiqh of Worship",
      recurring_day_of_week: undefined,
      id: "sub-1",
    } as never);

    expect(patch).toEqual({ title: "Fiqh of Worship" });
  });
});

describe("uniqueSubjectSlug", () => {
  it("slugifies a title", () => {
    expect(slugify("Fiqh of Worship!")).toBe("fiqh-of-worship");
  });

  it("suffixes on collision", () => {
    expect(uniqueSubjectSlug("Tafseer", ["tafseer"])).toBe("tafseer-2");
    expect(uniqueSubjectSlug("Tafseer", ["tafseer", "tafseer-2"])).toBe(
      "tafseer-3"
    );
  });

  it("does not collide a subject with its own existing slug", () => {
    expect(uniqueSubjectSlug("Tafseer", ["tafseer"], "tafseer")).toBe("tafseer");
  });

  it("falls back when a title has no slug-able characters", () => {
    expect(uniqueSubjectSlug("…", [])).toBe("subject");
  });
});

describe("moveInOrder", () => {
  it("swaps neighbours", () => {
    expect(moveInOrder(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveInOrder(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  });

  it("returns the same array reference at the edges, so callers can skip the write", () => {
    const items = ["a", "b"];
    expect(moveInOrder(items, 0, -1)).toBe(items);
    expect(moveInOrder(items, 1, 1)).toBe(items);
  });
});
