import { expect, test, type Page } from "@playwright/test";
import { addChild, lessonQuestions, registerParent, startLesson } from "./helpers";

// What the browser is actually asked to say, end to end: lesson content from the database
// (sound tokens) → the sound table in the payload → the pronunciation resolver → the
// browser's speech synthesis. A fake engine records every utterance. Phonics sounds must
// be spoken as sounds (suh, shuh), letter names as names (ess, aitch), and never as raw
// tokens or letter strings (sss, th).

async function recordSpeech(page: Page) {
  await page.addInitScript(() => {
    const spoken: string[] = [];
    (window as unknown as { __spoken: string[] }).__spoken = spoken;
    class Utterance {
      text: string;
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
  await expect.poll(() => spoken(page)).toContainEqual(expect.stringContaining("This is the letter ess."));
  await expect.poll(() => spoken(page)).toContainEqual(expect.stringContaining("It says suh"));
  await page.getByRole("button", { name: /sound/i }).first().click();
  await expect.poll(async () => (await spoken(page)).at(-1)).toBe("suh");
  // Each page load starts a new recording: keep what this page said.
  const all = await spoken(page);

  // The sh lesson: the intro names the letters and says the sound.
  const { lessonId: sh } = await lessonQuestions("kg3-sh-1");
  await page.goto(`/child/learn/${sh}`);
  await expect.poll(() => spoken(page)).toContainEqual("Let's learn ess aitch. It says shuh!");
  all.push(...(await spoken(page)));

  expect(all.length).toBeGreaterThan(3);
  for (const text of all) {
    // Never a raw token, never letters a voice reads as letter names.
    expect(text).not.toMatch(/\{[/@]/);
    expect(text).not.toMatch(/\b(sss|shh|hh|th|sh|ng)\b/i);
  }
});
