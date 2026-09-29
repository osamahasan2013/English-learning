import { beforeAll, describe, expect, it } from "vitest";
import { levelId, registerParent, serviceClient, type Client } from "./helpers";

// The multi-child family model through the real API: each family can create and manage
// only its own children, and no family can reach another's children or progress,
// whatever ids it sends.
describe("families and children (RLS through PostgREST)", () => {
  let a: { client: Client; userId: string };
  let b: { client: Client; userId: string };
  let kg1: string;
  let grade1: string;
  let childA1: string;
  let childA2: string;

  beforeAll(async () => {
    [a, b] = await Promise.all([registerParent("Parent A"), registerParent("Parent B")]);
    kg1 = await levelId(a.client, "KG1");
    grade1 = await levelId(a.client, "GRADE1");
  });

  it("a parent creates several children, owned by them regardless of what the client sends", async () => {
    const { data, error } = await a.client
      .from("children")
      .insert(
        [
          { name: "Aya", grade_level_id: kg1, current_level_id: kg1 },
          { name: "Adam", grade_level_id: grade1, current_level_id: grade1, daily_minutes: 20 },
        ],
        // Rows that omit a column keep its default instead of sending null.
        { defaultToNull: false },
      )
      .select("id, parent_id, name");
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data!.every((c) => c.parent_id === a.userId)).toBe(true);
    childA1 = data!.find((c) => c.name === "Aya")!.id;
    childA2 = data!.find((c) => c.name === "Adam")!.id;

    // Inserted in one statement, so they share created_at: compare as a set.
    const { data: list } = await a.client.from("children").select("id");
    expect(list!.map((c) => c.id).sort()).toEqual([childA1, childA2].sort());
  });

  it("a parent cannot create a child for another parent", async () => {
    const { error } = await b.client
      .from("children")
      .insert({ parent_id: a.userId, name: "Sneaky", grade_level_id: kg1, current_level_id: kg1 });
    expect(error?.code).toBe("42501"); // parent_id is not writable; it defaults to the caller
  });

  it("another parent cannot see, edit or remove those children", async () => {
    const read = await b.client.from("children").select("id").in("id", [childA1, childA2]);
    expect(read.data).toEqual([]);

    const update = await b.client.from("children").update({ name: "Hacked" }).eq("id", childA1).select("id");
    expect(update.data).toEqual([]);

    const archive = await b.client.rpc("archive_child", { p_child_id: childA1 });
    expect(archive.error?.message).toBe("CHILD_NOT_FOUND");

    const owned = await serviceClient()
      .from("children")
      .select("name, deleted_at")
      .eq("id", childA1)
      .single();
    expect(owned.data).toEqual({ name: "Aya", deleted_at: null });
  });

  it("progress is visible only to the owning family and writable only by the server", async () => {
    const service = serviceClient();
    const { error: fixtureError } = await service.from("reward_events").insert({
      child_id: childA1,
      source_type: "lesson_run",
      source_id: crypto.randomUUID(),
      points: 10,
      stars: 2,
    });
    expect(fixtureError).toBeNull();

    expect((await a.client.from("reward_events").select("stars").eq("child_id", childA1)).data).toEqual([
      { stars: 2 },
    ]);
    expect((await b.client.from("reward_events").select("stars").eq("child_id", childA1)).data).toEqual([]);

    const forge = await a.client.from("reward_events").insert({
      child_id: childA1,
      source_type: "lesson_run",
      source_id: crypto.randomUUID(),
      points: 999,
      stars: 3,
    });
    expect(forge.error?.code).toBe("42501");
  });

  it("a parent edits their own child's grade and learning level", async () => {
    const { data, error } = await a.client
      .from("children")
      .update({ grade_level_id: grade1, current_level_id: kg1, daily_minutes: 30 })
      .eq("id", childA1)
      .select("grade_level_id, current_level_id, daily_minutes")
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({ grade_level_id: grade1, current_level_id: kg1, daily_minutes: 30 });
  });

  it("rejects invalid values at the database, not just in the app", async () => {
    const minutes = await a.client.from("children").update({ daily_minutes: 7 }).eq("id", childA1);
    expect(minutes.error?.code).toBe("23514");
    const blank = await a.client
      .from("children")
      .insert({ name: "   ", grade_level_id: kg1, current_level_id: kg1 });
    expect(blank.error?.code).toBe("23514");
  });

  it("a parent cannot promote themselves to admin", async () => {
    const { error } = await a.client.from("profiles").update({ role: "admin" }).eq("id", a.userId);
    expect(error?.code).toBe("42501");
  });

  it("archiving a child hides it and its progress from the family", async () => {
    expect((await a.client.rpc("archive_child", { p_child_id: childA2 })).error).toBeNull();
    const { data } = await a.client.from("children").select("id");
    expect(data!.map((c) => c.id)).toEqual([childA1]);
  });
});
