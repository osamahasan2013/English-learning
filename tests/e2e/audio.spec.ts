import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_RULES } from "../../src/lib/learning/rules";
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
// Phase 8.2: speech is paced for the level (KG3 here): Slow reads the same words from the
// start at the level's slow rate in short phrases, and phonics sounds are separate pieces.
// These are behaviour checks; they do not prove how a real device's voice sounds.

const KG3 = DEFAULT_RULES.audio.levels.KG3;
const SLOW_RATE = KG3.slow.rate;
// A slow piece of `text`: its beginning, at the slow rate.
const slowStartOf = (text: string | undefined) => (e: SpeechLogEntry) =>
  e.rate === SLOW_RATE && !!text && !!e.text && text.startsWith(e.text);
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
      await eventually(page, (log) => {
        const first = startsAfter(log, t)[0];
        return !!first && slowStartOf(text)(first);
      });

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
      // The last press (Slow) wins: its words at the slow reading rate, any sound in them at
      // the (even slower) phonics rate.
      expect(after.at(-1)!.rate).toBeLessThanOrEqual(SLOW_RATE);

      // Again repeats the last speed.
      t = await now(page);
      await page.getByRole("button", { name: /Again/ }).first().click();
      await eventually(page, (log) => {
        const first = startsAfter(log, t)[0];
        return !!first && slowStartOf(text)(first);
      });
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
      // Slow while reading: the first sentence again from its start, slowly, in short phrases.
      t = await now(page);
      await story.getByRole("button", { name: /Slow/ }).click();
      await eventually(page, (log) => {
        const pieces = startsAfter(log, t);
        return pieces.length > 1 && slowStartOf(first)(pieces[0]) && pieces[0].text !== first;
      });
      // A tapped word stops the story; the story's buttons are ready to start again.
      t = await now(page);
      await story.getByRole("button", { name: "shell", exact: true }).first().click();
      // A tapped word is a WORD: said whole, in its citation form ("shell.").
      await eventually(page, (log) => startsAfter(log, t).some((e) => e.text === "shell."));
      await page.waitForTimeout(1200);
      expect(startsAfter(await speechLog(page), t).map((e) => e.text)).toEqual(["shell."]);
      await expect(story.getByRole("button", { name: /^(🔊 )?Listen$/ })).toBeVisible();

      // Read it again: the story starts over from the first sentence (at the last speed, Slow).
      await story.getByRole("button", { name: /I read it/ }).click();
      t = await now(page);
      await story.getByRole("button", { name: /Read it again/ }).click();
      await eventually(page, (log) => {
        const firstPiece = startsAfter(log, t)[0];
        return !!firstPiece && slowStartOf(first)(firstPiece);
      });
      expect(overlaps(await speechLog(page))).toEqual([]);

      // Leaving the screen while it reads stops it.
      await page.getByRole("link", { name: /home/i }).first().click();
      await expect(page).toHaveURL(/\/child\/home/);
      t = await now(page);
      await page.waitForTimeout(1500);
      expect(
        startsAfter(await speechLog(page), t).filter((e) => sentences.some((s) => s.includes(e.text!))),
      ).toEqual([]);
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
    // Letters may be NAMED ("S and H together"), but the sound is never letter names.
    expect(text, text).not.toMatch(/\b(says?|sound:?)\s+(S H|ess aitch|s h)\b/i);
  }
  expect(said.some((t) => /\bshuh\b/.test(t))).toBe(true);
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

test("a spelling intro says the word and its sounds as separate pieces, never one run", async ({ page }) => {
  await childAt(page, "deferred", /Grade 1/);
  const { lessonId, questions } = await lessonQuestions("g1-spell-magic-e-1");
  await page.goto(`/child/learn/${lessonId}`);
  await startLesson(page);
  for (let guard = 0; guard < 8; guard++) {
    await section(page).first().waitFor();
    const q = questions.get((await section(page).getAttribute("data-question-id"))!)!;
    if (JSON.stringify(q.content).includes("{/G/}")) break;
    const next = page.getByRole("button", { name: /^Next/ });
    if (!(await next.isVisible())) await answerQuestion(page, q, true);
    await next.click();
  }
  const pieces = ["gate.", "guh", "eigh", "tuh", "gate."];
  await eventually(
    page,
    (log) =>
      heard(log)
        .map((e) => e.text)
        .join("|")
        .includes(pieces.join("|")),
    10_000,
  );
  const said = heard(await speechLog(page));
  const at = said.findIndex((e, i) => pieces.every((p, k) => said[i + k]?.text === p));
  const run = said.slice(at, at + pieces.length);
  const gap = DEFAULT_RULES.audio.phonics.tokenGapMs.normal;
  for (let i = 1; i < run.length; i++) expect(run[i].t - run[i - 1].t).toBeGreaterThanOrEqual(gap);
  // The sounds at the phonics rate, the word at the reading rate.
  expect(run[1].rate).toBe(DEFAULT_RULES.audio.phonics.rate.normal);
  expect(run[0].rate).toBe(DEFAULT_RULES.audio.levels.GRADE1.normal.rate);
  expect(overlaps(await speechLog(page))).toEqual([]);
});

test("the grown-ups' audio check: letter name vs sound vs word, Normal vs Slow, results", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await installFakeSpeech(page, "deferred");
  await registerParent(page, "Audio Check");
  await page.goto("/parent/settings");
  await page.getByRole("link", { name: "Open the audio check" }).click();
  await expect(page.getByRole("heading", { name: "Audio check" })).toBeVisible();
  await page.getByRole("combobox").selectOption("KG1");
  const card = (id: string) => page.locator(`[data-check="${id}"]`);
  const play = async (id: string) => {
    await clearSpeechLog(page);
    await card(id)
      .getByRole("button", { name: /^Play:/ })
      .click();
    await expect(card(id).locator("[data-timing]")).toContainText(/heard/, { timeout: 15_000 });
    return heard(await speechLog(page)).map((e) => e.text);
  };
  // What each test means, and where its sound comes from (no recordings: the device voice).
  await expect(card("letter-g").locator("[data-intent]")).toHaveText("LETTER_NAME");
  await expect(card("letter-g").locator("[data-target]")).toHaveText("G");
  await expect(card("letter-g").locator("[data-source]")).toHaveText("device voice (TTS)");
  await expect(card("phoneme-g").locator("[data-intent]")).toHaveText("PHONEME");
  await expect(card("word-the").locator("[data-intent]")).toHaveText("WORD");
  // The letter NAME is the capital letter with a full stop (its whole name, not clipped);
  // the SOUND is the sound; a word is the word — never letters or sounds.
  for (const l of ["A", "G", "S", "T"]) expect(await play(`letter-${l.toLowerCase()}`)).toEqual([`${l}.`]);
  expect(await play("phoneme-g")).toEqual(["guh"]);
  expect(await play("phoneme-s")).toEqual(["sah"]);
  expect(await play("word-gate")).toEqual(["gate."]);
  expect(await play("word-the")).toEqual(["the."]);
  expect(await play("segmenting")).toEqual(["guh", "eigh", "tuh"]);
  expect(await play("blending")).toEqual(["guh", "eigh", "tuh", "gate."]);
  expect(await play("letter-intro")).toEqual(["This is the letter G.", "It says guh, as in goat."]);
  // Reading: "the" always with its word, at Normal and at Slow.
  expect(await play("reading-1-normal")).toEqual(["The cat is", "at the gate."]);
  expect(await play("reading-1-slow")).toEqual(["The cat", "is", "at", "the gate."]);
  const ratio = Number((await page.locator("[data-ratio] li").first().innerText()).match(/([\d.]+)×/)![1]);
  expect(ratio).toBeGreaterThan(1.5);
  await card("letter-g").getByRole("button", { name: "❌ FAIL" }).click();
  await card("letter-g").getByRole("textbox").fill("heard S");
  await card("reading-1-slow").getByRole("button", { name: "✅ PASS" }).click();
  await page.getByRole("button", { name: /Copy results/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Copied." })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^Word Garden audio check — \d{4}-\d\d-\d\dT/);
  // The tablet project emulates an iPad (its user agent); the voice is the fake engine's.
  expect(copied).toMatch(/Device: iOS [\d.]+, Safari · voice: Fake Samantha \(on device\) · locale: en-US/);
  expect(copied).toContain(
    "letter-g [KG1] FAIL · intent LETTER_NAME · target G · source tts · note: heard S",
  );
  expect(copied).toMatch(
    /reading-1-slow \[KG1\] PASS · intent STORY_READING · target The cat is at the gate\. · source tts · rate 0.62 · 4 pieces/,
  );
  expect(copied).toMatch(
    /KG1 Slow \/ Normal “The cat is at the gate\.”: Slow took [\d.]+× as long as Normal/,
  );
});
