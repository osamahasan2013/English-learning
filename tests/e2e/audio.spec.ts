import { expect, test, type Page } from "@playwright/test";
import { addChild, answerQuestion, lessonQuestions, registerParent, startLesson } from "./helpers";
import {
  clearSpeechLog,
  heard,
  installFakeSpeech,
  overlaps,
  speechLog,
  type SpeechLogEntry,
  type SpeechMode,
} from "./fake-speech";

// Audio reliability (Phase 8.1), with real lessons from the database and an instrumented
// speech engine (fake-speech.ts) — headless Chromium has no voices of its own. "deferred"
// models WebKit / Android Chrome, where cancel() is processed after the current task and
// takes an utterance spoken right after it with it; "immediate" models desktop Chrome.
// Slow, Try again, Read it again, Start again, rapid presses, a tapped word, leaving the
// screen and an engine with no voices are all checked against what was actually heard.

const SLOW_RATE = 0.6;
const section = (page: Page) => page.locator("section[data-question-id]");

async function eventually(page: Page, check: (log: SpeechLogEntry[]) => boolean, timeout = 6000) {
  await expect.poll(async () => check(await speechLog(page)), { timeout }).toBe(true);
}

const startsAfter = (log: SpeechLogEntry[], t: number) => heard(log).filter((e) => e.t >= t);
const now = (page: Page) => page.evaluate(() => Math.round(performance.now()));

async function childAt(page: Page, mode: SpeechMode, level = /Kindergarten 3/) {
  await installFakeSpeech(page, mode);
  await registerParent(page);
  await addChild(page, "Ivy", level);
  await page.getByRole("button", { name: /Start learning as Ivy/ }).click();
  await expect(page).toHaveURL(/\/child\/home/);
}

// The deferred engine (iOS Safari, Android Chrome) is also checked on a phone and a desktop
// screen; this file runs in the default (tablet) project.
const DEVICES = {
  tablet: null,
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false },
} as const;
const RUNS = [
  ["deferred", "tablet"],
  ["deferred", "mobile"],
  ["deferred", "desktop"],
  ["immediate", "tablet"],
] as const;

for (const [mode, device] of RUNS) {
  test.describe(`speech engine: ${mode} cancel, ${device}`, () => {
    if (DEVICES[device]) test.use(DEVICES[device]);
    test("Listen, Slow, Again and rapid presses: one voice at a time, the last press wins", async ({
      page,
    }) => {
      await childAt(page, mode);
      const { lessonId } = await lessonQuestions("kg3-sh-1");
      await page.goto(`/child/learn/${lessonId}`);
      const listen = page.getByRole("button", { name: /^(🔊 )?Listen$/ }).first();
      await expect(listen).toBeVisible();
      // Let the automatic reading of the intro start, then press Listen in the middle of it.
      await eventually(page, (log) => heard(log).length > 0);
      let t = await now(page);
      await listen.click();
      await eventually(page, (log) => startsAfter(log, t).length > 0);
      const text = startsAfter(await speechLog(page), t)[0].text;

      // Slow while Listen is still speaking: the same words again, slower.
      t = await now(page);
      await page.getByRole("button", { name: /Slow/ }).first().click();
      await eventually(page, (log) =>
        startsAfter(log, t).some((e) => e.text === text && e.rate === SLOW_RATE),
      );

      // Slow → Slow, then normal → slow → normal → slow pressed quickly.
      t = await now(page);
      await page.getByRole("button", { name: /Slow/ }).first().click();
      await eventually(page, (log) => startsAfter(log, t).some((e) => e.rate === SLOW_RATE));
      t = await now(page);
      for (const name of [/^(🔊 )?Listen$/, /Slow/, /^(🔊 )?Listen$/, /Slow/])
        await page.getByRole("button", { name }).first().click();
      await page.waitForTimeout(1500);
      const after = startsAfter(await speechLog(page), t);
      expect(after.length).toBeGreaterThan(0);
      expect(after.at(-1)!.rate).toBe(SLOW_RATE);

      // Again repeats the last speed.
      t = await now(page);
      await page.getByRole("button", { name: /Again/ }).first().click();
      await eventually(page, (log) =>
        startsAfter(log, t).some((e) => e.text === text && e.rate === SLOW_RATE),
      );
      expect(overlaps(await speechLog(page))).toEqual([]);
      // A voice was chosen once the voices loaded.
      expect(heard(await speechLog(page)).at(-1)!.voice).toBe("Fake Samantha");
    });

    test("Try again reads the question again after the feedback", async ({ page }) => {
      await childAt(page, mode);
      const { lessonId, questions } = await lessonQuestions("kg3-sh-1");
      await page.goto(`/child/learn/${lessonId}`);
      await startLesson(page);
      for (let guard = 0; guard < 20; guard++) {
        await section(page).first().waitFor();
        const q = questions.get((await section(page).getAttribute("data-question-id"))!)!;
        const next = page.getByRole("button", { name: /^Next/ });
        if (q.question_type === "INTRO" || (await next.isVisible())) {
          await next.click();
          continue;
        }
        await answerQuestion(page, q, false);
        break;
      }
      const tryAgain = page.getByRole("button", { name: "Try again" });
      await expect(tryAgain).toBeVisible();
      // The feedback is being said when the child presses Try again.
      await eventually(page, (log) => heard(log).length > 0);
      const t = await now(page);
      await tryAgain.click();
      await eventually(page, (log) => startsAfter(log, t).length > 0);
      expect(overlaps(await speechLog(page))).toEqual([]);
    });

    test("a story: Listen, Slow, Start again, a tapped word, Read it again", async ({ page }) => {
      await childAt(page, mode);
      const { lessonId, questions } = await lessonQuestions("kg3-read-sam-and-the-shell");
      await page.goto(`/child/learn/${lessonId}`);
      await startLesson(page);
      for (let guard = 0; guard < 20; guard++) {
        await section(page).first().waitFor();
        const q = questions.get((await section(page).getAttribute("data-question-id"))!)!;
        if (q.question_type === "READ_PASSAGE") break;
        const next = page.getByRole("button", { name: /^Next/ });
        if (!(await next.isVisible())) await answerQuestion(page, q, true);
        await next.click();
      }
      const story = section(page);
      const sentences = await story.locator("[data-sentence]").allInnerTexts();
      expect(sentences.length).toBeGreaterThan(1);
      const first = sentences[0].trim();

      let t = await now(page);
      await story.getByRole("button", { name: /Listen/ }).click();
      await eventually(page, (log) => startsAfter(log, t).some((e) => e.text === first));
      // Start again while it is reading: back to the first sentence (not a duplicate).
      t = await now(page);
      await story.getByRole("button", { name: /Start again/ }).click();
      await eventually(page, (log) => startsAfter(log, t)[0]?.text === first);
      // Slow while reading: the first sentence again, slowly.
      t = await now(page);
      await story.getByRole("button", { name: /Slow/ }).click();
      await eventually(page, (log) =>
        startsAfter(log, t).some((e) => e.text === first && e.rate === SLOW_RATE),
      );
      // A tapped word stops the story; the story's buttons are ready to start again.
      t = await now(page);
      await story.getByRole("button", { name: "shell", exact: true }).first().click();
      await eventually(page, (log) => startsAfter(log, t).some((e) => e.text === "shell"));
      await page.waitForTimeout(1200);
      expect(startsAfter(await speechLog(page), t).map((e) => e.text)).toEqual(["shell"]);
      await expect(story.getByRole("button", { name: /^(🔊 )?Listen$/ })).toBeVisible();

      // Read it again: the story starts over from the first sentence.
      await story.getByRole("button", { name: /I read it/ }).click();
      t = await now(page);
      await story.getByRole("button", { name: /Read it again/ }).click();
      await eventually(page, (log) => startsAfter(log, t)[0]?.text === first);
      expect(overlaps(await speechLog(page))).toEqual([]);

      // Leaving the screen while it reads stops it.
      await page.getByRole("link", { name: /home/i }).first().click();
      await expect(page).toHaveURL(/\/child\/home/);
      t = await now(page);
      await page.waitForTimeout(1500);
      expect(startsAfter(await speechLog(page), t).filter((e) => sentences.includes(e.text!))).toEqual([]);
    });
  });
}

test("phonics sounds are never spoken as letter names", async ({ page }) => {
  await childAt(page, "immediate");
  const { lessonId, questions } = await lessonQuestions("kg3-sh-1");
  await page.goto(`/child/learn/${lessonId}`);
  await startLesson(page);
  await clearSpeechLog(page);
  for (let guard = 0; guard < 6; guard++) {
    await section(page).first().waitFor();
    const q = questions.get((await section(page).getAttribute("data-question-id"))!)!;
    const next = page.getByRole("button", { name: /^Next/ });
    if (!(await next.isVisible())) await answerQuestion(page, q, true);
    await page.waitForTimeout(800);
    await next.click();
  }
  const said = heard(await speechLog(page)).map((e) => e.text ?? "");
  expect(said.length).toBeGreaterThan(0);
  for (const text of said) {
    expect(text, text).not.toMatch(/\{|\}|\/[A-Z]+\//);
    expect(text, text).not.toMatch(/\b(ess aitch|s h|aitch)\b/i);
  }
});

test("no voices on the device: the child is told, and the lesson still works", async ({ page }) => {
  await childAt(page, "broken");
  const { lessonId } = await lessonQuestions("kg3-sh-1");
  await page.goto(`/child/learn/${lessonId}`);
  await page
    .getByRole("button", { name: /^(🔊 )?Listen$/ })
    .first()
    .click();
  await expect(page.getByRole("status").filter({ hasText: /Audio isn.t available right now/ })).toBeVisible();
  await startLesson(page);
  await expect(section(page).first()).toBeVisible();
});
