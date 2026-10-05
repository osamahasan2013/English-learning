import { expect, test, type Page } from "@playwright/test";
import { addChild, answerQuestion, lessonQuestions, registerParent, startLesson } from "./helpers";

// What the browser is actually asked to say, end to end: lesson content from the database
// (sound tokens) → the sound table in the payload → the pronunciation resolver → the
// browser's speech synthesis. A fake engine records every utterance. Phonics sounds must
// be spoken as sounds (sah, shuh), letter names as names (the capital letter, which every
// voice reads as its name), and never as raw tokens or letter strings (sss, th). Since
// Phase 8.3 a letter name or a single sound stays inside its sentence ("This is the letter
// S." / "It says sah, as in sun."), so the checks look for those pieces in order.

async function recordSpeech(page: Page) {
  await page.addInitScript(() => {
    const spoken: string[] = [];
    (window as unknown as { __spoken: string[] }).__spoken = spoken;
    class Utterance {
      text: string;
      onstart?: () => void;
      onend?: () => void;
      onerror?: (e: { error: string }) => void;
      constructor(text: string) {
        this.text = text;
      }
    }
    Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: Utterance });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speak: (u: Utterance) => {
          spoken.push(u.text);
          setTimeout(() => u.onstart?.(), 0);
          setTimeout(() => u.onend?.(), 30);
        },
        cancel: () => {},
        getVoices: () => [],
        addEventListener: () => {},
      },
    });
  });
}
const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
// The pieces said in this order, one after another.
const saidInOrder = async (page: Page, run: string[]) => {
  const all = await spoken(page);
  return all.some((_, i) => run.every((piece, k) => all[i + k] === piece));
};

test("phonics sounds are spoken as sounds and letter names as names", async ({ page }) => {
  await recordSpeech(page);
  await registerParent(page);
  await addChild(page, "Lu", /Kindergarten 3/);
  await page.getByRole("button", { name: /Start learning as Lu/ }).click();
  await expect(page).toHaveURL(/\/child\/home/);

  // The letter s: its name and its sound, kept apart.
  const { lessonId: letterS } = await lessonQuestions("kg1-letter-s-1");
  await page.goto(`/child/learn/${letterS}`);
  await startLesson(page);
  await expect.poll(() => saidInOrder(page, ["This is the letter S.", "It says sah, as in sun."])).toBe(true);
  await page.getByRole("button", { name: /sound/i }).first().click();
  await expect.poll(async () => (await spoken(page)).at(-1)).toBe("sah");
  // Each page load starts a new recording: keep what this page said.
  const all = await spoken(page);

  // The sh lesson: the intro names the letters and says the sound.
  const { lessonId: sh } = await lessonQuestions("kg3-sh-1");
  await page.goto(`/child/learn/${sh}`);
  await expect.poll(() => saidInOrder(page, ["Let's learn S H.", "It says shuh!"])).toBe(true);
  all.push(...(await spoken(page)));

  expect(all.length).toBeGreaterThan(3);
  for (const text of all) {
    // Never a raw token, never letters a voice reads as letter names.
    expect(text).not.toMatch(/\{[/@]/);
    expect(text).not.toMatch(/\b(sss|shh|hh|th|sh|ng)\b/i);
  }
});

test("a sound named by a keyword never names one of the answer choices", async ({ page }) => {
  await recordSpeech(page);
  await registerParent(page);
  await addChild(page, "Ivo", /Kindergarten 1/);
  await page.getByRole("button", { name: /Start learning as Ivo/ }).click();
  await expect(page).toHaveURL(/\/child\/home/);

  // Letter a: "Which one starts with /a/?" with apple among the choices. Short a cannot be
  // synthesised, so it is named by a keyword, which must not be "apple".
  const { lessonId, questions } = await lessonQuestions("kg1-letter-a-1");
  const target = [...questions.values()].find(
    (q) => q.question_type === "PICTURE_MATCH" && JSON.stringify(q.content).includes('"apple"'),
  )!;
  await page.goto(`/child/learn/${lessonId}`);
  await startLesson(page);
  for (let guard = 0; guard < 20; guard++) {
    const id = await page.locator("section[data-question-id]").getAttribute("data-question-id");
    if (id === target.id) break;
    const next = page.getByRole("button", { name: /^Next/ });
    if (!(await next.isVisible())) await answerQuestion(page, questions.get(id!)!, true);
    await page.getByRole("button", { name: /^Next/ }).click();
  }
  await expect
    .poll(() => saidInOrder(page, ["Which one starts with the sound at the start of ant?"]))
    .toBe(true);
});
