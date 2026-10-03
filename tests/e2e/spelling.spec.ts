import { expect, test, type Page } from "@playwright/test";
import {
  addChild,
  admin,
  answerQuestion,
  lessonQuestions,
  passParentGate,
  playLesson,
  registerParent,
  startLesson,
  waitForSynced,
  writeSpelling,
} from "./helpers";

// Phase 6 vertical slice, with real content from the database: child dashboard → Spelling
// → a spelling lesson → listen → build / type → submit → the mistake is named (ship → sip:
// two letters make that sound) → hint → retry → the server re-checks and stores every
// answer with its analysis → spelling mastery → spelling and phonics-pattern review items →
// the parent sees the spelling report.

const section = (page: Page) => page.locator("section[data-question-id]");

async function currentQuestionId(page: Page) {
  const finished = page.getByRole("heading", { level: 1, name: /You finished|Great practice/ });
  await finished.or(section(page)).first().waitFor();
  if (await finished.isVisible()) return null;
  return section(page).getAttribute("data-question-id");
}

test("a child learns to spell, makes and fixes a mistake, and the parent sees the analysis", async ({
  page,
}) => {
  await registerParent(page);
  const childId = await addChild(page, "Sam", /Kindergarten 3/);
  await page.getByRole("button", { name: /Start learning as Sam/ }).click();
  await expect(page).toHaveURL(/\/child\/home/);

  // Child dashboard → Spelling.
  await page
    .getByRole("link", { name: /Spelling/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/child\/spelling$/);
  const nav = page.getByRole("navigation", { name: "Spelling" });
  for (const card of ["Learn", "Practice", "Dictation", "My Words", "Review"])
    await expect(nav.getByText(card, { exact: true })).toBeVisible();
  // Word families reinforce spelling patterns.
  await expect(page.getByRole("heading", { name: /Word families/ })).toBeVisible();
  await expect(page.locator('a[href^="/child/spelling/practice?family="]').first()).toBeVisible();

  // Learn → the sh / ch spelling lesson (real content: a spelling_set blueprint).
  const { lessonId, questions } = await lessonQuestions("kg3-spell-sh-ch");
  await page.getByRole("link", { name: /Spell sh and ch words/ }).click();
  await expect(page).toHaveURL(new RegExp(`/child/learn/${lessonId}$`));
  await startLesson(page);

  // Answer everything right up to the first "listen and type" step.
  const { data: ship } = await admin.from("words").select("id").eq("normalized_word", "ship").single();
  for (let guard = 0; guard < 40; guard++) {
    const id = await currentQuestionId(page);
    const q = questions.get(id!)!;
    if (q.question_type === "SPELLING" && (q.content as { mode?: string }).mode === "listen") break;
    const next = page.getByRole("button", { name: /^Next/ });
    if (await next.isVisible()) {
      await next.click();
      continue;
    }
    await answerQuestion(page, q, true);
    await page.getByRole("button", { name: /^Next/ }).click();
  }
  const first = questions.get((await currentQuestionId(page))!)!;
  expect((first.answer as { accepted: string[] }).accepted[0]).toBe("ship");
  // KG3 writes with the child keyboard (the level's spelling rules).
  await expect(section(page).locator('[data-input-method="ON_SCREEN_KEYBOARD"]')).toBeVisible();
  await expect(
    section(page)
      .getByRole("button", { name: /Listen/ })
      .first(),
  ).toBeVisible();

  // ship → sip: the mistake is named and the child's letters are marked (no answer shown).
  await writeSpelling(page, "sip");
  const mistake = page.getByTestId("spelling-mistake");
  await expect(mistake).toHaveAttribute("data-category", "WRONG_DIGRAPH");
  await expect(mistake.getByText(/Remember: SH makes one sound|Two letters|two-letter sound/i)).toBeVisible();
  await expect(mistake.getByText("You wrote:")).toBeVisible();
  await expect(mistake.getByText("The word:")).toHaveCount(0);

  // Retry with a hint.
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByTestId("hints").getByRole("button", { name: /Hint/ }).click();
  await expect(page.getByRole("list", { name: "Hints" })).toBeVisible();
  await writeSpelling(page, "ship");
  await expect(page.getByRole("status").filter({ hasText: /./ }).first()).toBeVisible();

  // The rest of the lesson: right, except the one-try check at the end (shop, dish).
  for (let guard = 0; guard < 60; guard++) {
    const id = await currentQuestionId(page);
    if (id === null) break;
    const q = questions.get(id)!;
    const next = page.getByRole("button", { name: /^Next/ });
    if (await next.isVisible()) {
      await next.click();
      continue;
    }
    const dictation = q.question_type === "SPELLING" && (q.content as { mode?: string }).mode === "dictation";
    if (dictation)
      await writeSpelling(
        page,
        (q.answer as { accepted: string[] }).accepted[0].replace("sh", "s"),
        (q.content as { tiles?: string[] }).tiles,
      );
    else await answerQuestion(page, q, true);
  }
  await expect(page.getByRole("heading", { level: 1, name: /You finished/ })).toBeVisible();
  await waitForSynced(page);

  // Stored once, re-checked by the server, with the spelling analysis.
  const { data: shipAttempts } = await admin
    .from("activity_attempts")
    .select(
      "attempt_number, response, is_correct, error_type, hints_used, spelling_analysis, error_pattern_id, questions(question_type, metadata)",
    )
    .eq("child_id", childId)
    .eq("word_id", ship!.id)
    .eq("question_type", "SPELLING")
    .order("attempt_number");
  const { data: sh } = await admin.from("phonics_patterns").select("id").eq("code", "SH").single();
  expect(shipAttempts).toHaveLength(2);
  expect(shipAttempts![0]).toMatchObject({
    attempt_number: 1,
    response: { value: "sip" },
    is_correct: false,
    error_type: "WRONG_DIGRAPH",
    error_pattern_id: sh!.id,
    hints_used: 0,
  });
  expect(shipAttempts![0].spelling_analysis).toMatchObject({
    normalized: "sip",
    category: "WRONG_DIGRAPH",
    patternCode: "SH",
  });
  expect(shipAttempts![1]).toMatchObject({ attempt_number: 2, is_correct: true, hints_used: 1 });

  // Spelling mastery (separate from vocabulary): ship was missed on its first try.
  await expect
    .poll(async () => {
      const { data } = await admin
        .from("spelling_progress")
        .select("attempts_count, correct_count, status, last_error_type")
        .eq("child_id", childId)
        .eq("word_id", ship!.id)
        .maybeSingle();
      return data;
    })
    .toMatchObject({
      attempts_count: 1,
      correct_count: 0,
      status: "LEARNING",
      last_error_type: "WRONG_DIGRAPH",
    });
  const { count: mastered } = await admin
    .from("spelling_progress")
    .select("word_id", { count: "exact", head: true })
    .eq("child_id", childId)
    .eq("status", "MASTERED");
  expect(mastered).toBe(0);

  // Review queue: the word once (spelling:<id>, no duplicate word item for the same miss)
  // and the SH pattern, pointing at its phonics lesson.
  const { data: items } = await admin
    .from("review_items")
    .select("item_key, reason, status, lesson_id, phonics_pattern_id")
    .eq("child_id", childId)
    .eq("status", "open");
  expect(items!.filter((i) => i.item_key === `spelling:${ship!.id}`)).toEqual([
    expect.objectContaining({ reason: "missed_spelling" }),
  ]);
  // The vocabulary queue does not count the same spelling miss again (a saved word may
  // still have its own scheduled word review).
  expect(
    items!.filter(
      (i) => i.item_key === `word:${ship!.id}` && ["missed_word", "weak_word"].includes(i.reason),
    ),
  ).toEqual([]);
  const pattern = items!.find((i) => i.item_key === `pattern:${sh!.id}`);
  expect(pattern).toMatchObject({ reason: "spelling_pattern", phonics_pattern_id: sh!.id });
  const { data: shLesson } = await admin
    .from("lessons")
    .select("code")
    .eq("id", pattern!.lesson_id!)
    .single();
  expect(shLesson!.code).toMatch(/sh/);

  // Lesson progress and the spelling skill's mastery come from the same engine.
  const { data: lessonProgress } = await admin
    .from("lesson_progress")
    .select("status")
    .eq("child_id", childId)
    .eq("lesson_id", lessonId)
    .single();
  expect(lessonProgress!.status).toBe("COMPLETED");

  // The child's Review and My Words screens.
  await page.goto("/child/spelling/review");
  await expect(page.getByRole("link", { name: "ship", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Sounds to practise/ })).toBeVisible();
  // The misspelled pattern can be practised with other words that use it (sh → shop, fish …).
  await expect(page.getByRole("link", { name: /Spell sh words/ })).toHaveAttribute(
    "href",
    `/child/spelling/practice?pattern=${sh!.id}`,
  );
  await page.goto("/child/spelling/words");
  await expect(
    page.getByRole("list", { name: "Spelling words" }).getByRole("link", { name: /ship/ }),
  ).toBeVisible();

  // Practice the review words in the ordinary player (no lesson run).
  await page.goto("/child/spelling/practice?review=1");
  const reviewWordIds = items!
    .filter((i) => i.item_key.startsWith("spelling:"))
    .map((i) => i.item_key.slice(9));
  const { data: practiceRows } = await admin
    .from("questions")
    .select("id, question_type, content, answer")
    .in("word_id", reviewWordIds)
    .eq("status", "published");
  await playLesson(page, new Map((practiceRows ?? []).map((q) => [q.id, q])), true);
  await expect(page.getByRole("heading", { name: "Great practice!" })).toBeVisible();
  await waitForSynced(page);

  // Dictation for the child's level, with a replay limit.
  await page.goto("/child/spelling/dictation");
  await startLesson(page);
  await expect(page.getByText(/listens? left/)).toBeVisible();

  // The parent's spelling report reads the real answers.
  await page.goto("/child/home");
  await passParentGate(page);
  await page.goto(`/parent/spelling?child=${childId}`);
  await expect(page.getByRole("heading", { level: 2, name: /Sam's spelling/ })).toBeVisible();
  await expect(page.getByText("Words spelled").first()).toBeVisible();
  await expect(page.getByText("Two-letter sound").first()).toBeVisible();
  // The child's own words, exactly as written, in the (paginated) latest answers.
  for (let pageNo = 1; pageNo <= 8; pageNo++) {
    if ((await page.getByRole("cell", { name: "sip", exact: true }).count()) > 0) break;
    await page.getByRole("link", { name: "Older →" }).click();
    await expect(page.getByText(`Page ${pageNo + 1} of`)).toBeVisible();
  }
  await expect(page.getByRole("cell", { name: "sip", exact: true })).toBeVisible();
  await page.goto(`/parent/dashboard?child=${childId}`);
  await expect(page.getByRole("link", { name: "Spelling progress →" })).toBeVisible();
});
