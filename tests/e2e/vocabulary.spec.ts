import { expect, test } from "@playwright/test";
import { addChild, admin, passParentGate, playLesson, registerParent, waitForSynced } from "./helpers";

// Phase 5 vertical slice: child dashboard → Words → a category → Word Explorer (listen,
// meaning, example, sounds) → save to My Words → practice → answers → feedback → progress
// saved on the server → word mastery and review queue updated → the parent sees it.
test("a child explores a word, saves it, practises it, and the parent sees the progress", async ({
  page,
}) => {
  await registerParent(page);
  const childId = await addChild(page, "Zoe", /Grade 1/);
  await page.getByRole("button", { name: /Start learning as Zoe/ }).click();
  await expect(page).toHaveURL(/\/child\/home/);

  await page.getByRole("link", { name: /Words/ }).first().click();
  await expect(page).toHaveURL(/\/child\/words$/);
  for (const card of ["My Words", "New Words", "Practice", "Categories", "Word Explorer"])
    await expect(
      page.getByRole("navigation", { name: "Words" }).getByText(card, { exact: true }),
    ).toBeVisible();

  await page.getByRole("link", { name: /Feelings/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Feelings/ })).toBeVisible();
  await page.getByRole("link", { name: "sad", exact: true }).click();

  // The Word Explorer.
  const { data: sad } = await admin.from("words").select("id").eq("normalized_word", "sad").single();
  await expect(page).toHaveURL(new RegExp(`/child/words/${sad!.id}$`));
  await expect(page.getByRole("heading", { name: "sad", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Listen/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Slow/ }).first()).toBeVisible();
  await expect(page.getByText("How you feel when something is not nice.")).toBeVisible();
  await expect(page.getByText(/I am sad when it rains\./)).toBeVisible();
  await expect(page.getByRole("list", { name: "Sounds in sad" }).getByRole("button")).toHaveCount(3);
  await expect(page.getByText("Opposite:")).toBeVisible();

  await page.getByRole("button", { name: "Save to My Words" }).click();
  await expect(page.getByRole("button", { name: "In My Words" })).toBeVisible();
  await expect
    .poll(async () => {
      const { data } = await admin
        .from("word_progress")
        .select("is_saved, saved_source, first_seen_at")
        .eq("child_id", childId)
        .eq("word_id", sad!.id)
        .maybeSingle();
      return data;
    })
    .toMatchObject({ is_saved: true, saved_source: "manual" });

  // Practice the word in the ordinary player.
  await page.getByRole("link", { name: "Practice", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/child/words/${sad!.id}/practice$`));
  const { data: rows } = await admin
    .from("questions")
    .select("id, question_type, content, answer")
    .eq("word_id", sad!.id)
    .eq("status", "published");
  await playLesson(page, new Map((rows ?? []).map((q) => [q.id, q])), true);
  await expect(page.getByRole("heading", { name: "Great practice!" })).toBeVisible();
  await waitForSynced(page);

  // Stored once, checked by the server, no lesson run recorded for practice.
  const { data: attempts } = await admin
    .from("activity_attempts")
    .select("is_correct, lesson_run_id")
    .eq("child_id", childId)
    .eq("word_id", sad!.id);
  expect(attempts!.length).toBeGreaterThanOrEqual(3);
  expect(attempts!.every((a) => a.is_correct && a.lesson_run_id === null)).toBe(true);
  const { count: runs } = await admin
    .from("lesson_runs")
    .select("id", { count: "exact", head: true })
    .eq("child_id", childId);
  expect(runs).toBe(0);

  // Word mastery: better, but never mastered from one session.
  const { data: progress } = await admin
    .from("word_progress")
    .select("status, accuracy, attempts_count, is_saved")
    .eq("child_id", childId)
    .eq("word_id", sad!.id)
    .single();
  expect(progress!.is_saved).toBe(true);
  expect(Number(progress!.accuracy)).toBe(100);
  expect(["PRACTICING", "ALMOST_MASTERED"]).toContain(progress!.status);
  const { data: areas } = await admin
    .from("word_area_progress")
    .select("area")
    .eq("child_id", childId)
    .eq("word_id", sad!.id);
  expect(areas!.length).toBeGreaterThanOrEqual(2);
  // The saved word is scheduled in the review queue.
  const { data: review } = await admin
    .from("review_items")
    .select("reason, status")
    .eq("child_id", childId)
    .eq("word_id", sad!.id)
    .single();
  expect(review).toMatchObject({ reason: "due_review", status: "open" });

  // My Words lists it.
  await page.getByRole("link", { name: /Back to the word/ }).click();
  await page.goto("/child/words/mine");
  await expect(page.getByRole("link", { name: /sad/ })).toBeVisible();

  // The parent sees it.
  await passParentGate(page);
  await page.goto(`/parent/dashboard?child=${childId}`);
  await expect(page.getByText("Words practised").first()).toBeVisible();
  await page.getByRole("link", { name: "Vocabulary progress →" }).click();
  await expect(page.getByRole("heading", { name: "Zoe's vocabulary" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent words" })).toBeVisible();
  await expect(page.getByText(/sad/).first()).toBeVisible();
});

test("the word bank is searched in the database by pattern, shape and category", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "tablet", "search layout is covered once");
  await registerParent(page);
  await addChild(page, "Ari", /Kindergarten 2/);
  await page.goto("/parent/words?pattern=SH");
  await expect(page.getByRole("cell", { name: "ship", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "cat", exact: true })).toHaveCount(0);
  await page.goto("/parent/words?shape=CVC&category=ANIMALS");
  await expect(page.getByRole("cell", { name: "cat", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "elephant", exact: true })).toHaveCount(0);
  await page.goto("/parent/words?q=zzzz");
  await expect(page.getByText("No words match").first()).toBeVisible();
});
