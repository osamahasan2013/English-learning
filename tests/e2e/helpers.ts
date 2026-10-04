import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { correctWritingResponse, wrongWritingResponse } from "../writing-helpers";

// Test helpers: an admin client (service role) to look up answers and verify stored data,
// and page helpers that drive the app like a parent and a child would.

function loadEnv() {
  const file = path.resolve(__dirname, "../../.env.local");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
}
loadEnv();

export const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);

export function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

export async function registerParent(page: Page, name = "Test Parent") {
  const email = uniqueEmail("parent");
  await page.goto("/register");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  return email;
}

export async function addChild(page: Page, name: string, grade: RegExp) {
  await page.getByLabel("Child's first name or nickname").fill(name);
  await page.getByRole("button", { name: "owl" }).click();
  await page.getByLabel("School grade").selectOption({ label: (await optionLabel(page, grade))! });
  await page.getByRole("button", { name: "Add child" }).click();
  await expect(page).toHaveURL(/\/parent\/dashboard\?child=/);
  return new URL(page.url()).searchParams.get("child")!;
}

async function optionLabel(page: Page, pattern: RegExp) {
  const labels = await page.getByLabel("School grade").locator("option").allTextContents();
  return labels.find((l) => pattern.test(l));
}

export async function passParentGate(page: Page) {
  await page.getByRole("button", { name: /Grown-ups/ }).click();
  const question = await page.getByText(/What is \d+ × \d+\?/).textContent();
  const [, a, b] = question!.match(/(\d+) × (\d+)/)!;
  await page.getByLabel(/What is/).fill(String(Number(a) * Number(b)));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/parent\/dashboard/);
}

type QuestionRow = {
  id: string;
  question_type: string;
  content: Record<string, unknown>;
  answer: Record<string, unknown> | null;
};

export async function lessonQuestions(lessonCode: string) {
  const { data: lesson } = await admin.from("lessons").select("id").eq("code", lessonCode).single();
  const { data: activities } = await admin.from("activities").select("id").eq("lesson_id", lesson!.id);
  const { data: questions } = await admin
    .from("questions")
    .select("id, question_type, content, answer")
    .in(
      "activity_id",
      activities!.map((a) => a.id),
    )
    .eq("status", "published");
  return {
    lessonId: lesson!.id as string,
    questions: new Map((questions as QuestionRow[]).map((q) => [q.id, q])),
  };
}

// Leaves the lesson's intro screen (Start, or Try the whole lesson for a stretch lesson).
export async function startLesson(page: Page) {
  await page.getByRole("button", { name: /^(Start|Try the whole lesson|Start again)$/ }).click();
  await page.locator("section[data-question-id]").waitFor();
}

// Plays the lesson currently on screen to the end. `correct` answers every question
// correctly on the first try; otherwise every first try is wrong.
export async function playLesson(page: Page, questions: Map<string, QuestionRow>, correct: boolean) {
  for (let guard = 0; guard < 200; guard++) {
    const finished = page.getByRole("heading", { level: 1, name: /You finished|Nice peek|Great practice/ });
    const start = page.getByRole("button", { name: /^(Start|Try the whole lesson)$/ });
    const section = page.locator("section[data-question-id]");
    // Whichever screen the player is on (it first checks the device for a saved run).
    await finished.or(start).or(section).first().waitFor();
    if (await finished.isVisible()) return;
    if (await start.isVisible()) {
      await start.click();
      continue;
    }
    const q = questions.get((await section.getAttribute("data-question-id"))!)!;

    const next = page.getByRole("button", { name: /^Next/ });
    const retry = page.getByRole("button", { name: "Try again" });
    if (await retry.isVisible()) {
      await retry.click();
    } else if (await next.isVisible()) {
      await next.click();
      await page.waitForTimeout(50);
      continue;
    }
    await answerQuestion(page, q, correct);
    await page.waitForTimeout(50);
  }
  throw new Error("lesson did not finish");
}

export async function answerQuestion(page: Page, q: QuestionRow, correct: boolean) {
  const content = q.content as Record<string, never>;
  const answerSpec = q.answer as { accepted?: string[]; acceptedSequences?: string[][] };
  switch (q.question_type) {
    case "MULTIPLE_CHOICE":
    case "LISTEN_AND_CHOOSE":
    case "PICTURE_MATCH":
    case "BLEND_SOUNDS":
    case "READING": {
      const options = content.options as { id: string; text?: string; speech?: string }[];
      const target = correct
        ? options.find((o) => answerSpec.accepted!.includes(o.id))
        : options.find((o) => !answerSpec.accepted!.includes(o.id));
      await page
        .getByRole("group", { name: "Answers" })
        .getByRole("button", { name: target!.text ?? target!.speech ?? target!.id, exact: true })
        .click();
      return;
    }
    case "MISSING_LETTER": {
      const choices = content.choices as string[];
      const target = correct ? answerSpec.accepted![0] : choices.find((c) => c !== answerSpec.accepted![0])!;
      await page
        .getByRole("group", { name: "Choices" })
        .getByRole("button", { name: target, exact: true })
        .click();
      return;
    }
    case "WORD_BUILDER":
    case "SENTENCE_BUILDER": {
      const tiles = (q.question_type === "WORD_BUILDER" ? content.tiles : content.tokens) as string[];
      const slots = q.question_type === "WORD_BUILDER" ? (content.slots as number) : tiles.length;
      let order: string[];
      if (q.question_type === "SENTENCE_BUILDER") {
        order = correct ? answerSpec.acceptedSequences![0] : [...answerSpec.acceptedSequences![0]].reverse();
      } else {
        const { segmentWord } = await import("../../src/lib/learning/blending");
        const chunks = segmentWord(answerSpec.accepted![0], tiles);
        order = correct ? chunks : [...chunks].reverse();
      }
      for (const tile of order.slice(0, slots)) {
        await page
          .getByRole("group", { name: "Tiles" })
          .getByRole("button", { name: tile, exact: true })
          .first()
          .click();
      }
      await page.getByRole("button", { name: /Check/ }).click();
      return;
    }
    case "SEGMENT_WORD": {
      const sounds = content.sounds as { id: string; label: string }[];
      const expected = answerSpec.acceptedSequences![0];
      // Wrong: one sound too few (or too many for a two-sound word).
      const count = correct ? expected.length : expected.length === 2 ? 3 : expected.length - 1;
      await page
        .getByRole("group", { name: "Number of sounds" })
        .getByRole("button", { name: `${count} sounds`, exact: true })
        .click();
      const order = correct
        ? expected
        : Array.from({ length: count }, (_, i) => sounds[i % sounds.length].id);
      for (const id of order) {
        const sound = sounds.find((x) => x.id === id)!;
        await page
          .getByRole("group", { name: "Sound cards" })
          .getByRole("button", { name: `/${sound.label}/`, exact: true })
          .first()
          .click();
      }
      await page.getByRole("button", { name: /Check/ }).click();
      return;
    }
    case "FIND_PATTERN": {
      const word = content.word as string;
      const [start, end] = answerSpec.accepted![0].split("-").map(Number);
      const indexes = correct
        ? Array.from({ length: end - start + 1 }, (_, i) => start + i)
        : [end + 1 < word.length ? end + 1 : Math.max(0, start - 1)];
      const letters = page.getByRole("group", { name: "Letters in the word" }).getByRole("button");
      for (const i of indexes) await letters.nth(i).click();
      await page.getByRole("button", { name: /Check/ }).click();
      return;
    }
    case "SPELLING": {
      const target = answerSpec.accepted![0];
      await writeSpelling(
        page,
        correct ? target : wrongSpelling(target),
        content.tiles as string[] | undefined,
      );
      return;
    }
    case "SENTENCE_DICTATION": {
      const sentence = answerSpec.accepted![0];
      await writeSpelling(page, correct ? sentence : sentence.split(" ").slice(1).join(" "), undefined, true);
      return;
    }
    case "MATCH": {
      const left = content.left as Item[];
      const right = content.right as Item[];
      const pairs = (q.answer as { pairs: [string, string][] }).pairs;
      for (const [i, [l, r]] of pairs.entries()) {
        // Wrong: pair each left item with the next one's partner.
        const target = correct ? r : pairs[(i + 1) % pairs.length][1];
        await page
          .getByRole("list", { name: "Match these" })
          .getByRole("button", { name: itemLabel(left.find((x) => x.id === l)!), exact: true })
          .click();
        await page
          .getByRole("list", { name: "With these" })
          .getByRole("button", {
            name: new RegExp(`^${escape(itemLabel(right.find((x) => x.id === target)!))}`),
          })
          .click();
      }
      await page.getByRole("button", { name: /Check/ }).click();
      return;
    }
    case "SELECT_ALL": {
      const options = content.options as { id: string; text?: string }[];
      const right = (q.answer as { correct: string[] }).correct;
      const chosen = correct ? right : [options.find((o) => !right.includes(o.id))!.id];
      for (const id of chosen) {
        const option = options.find((o) => o.id === id)!;
        await page
          .getByRole("group", { name: "Answers" })
          .getByRole("button", { name: option.text ?? option.id, exact: true })
          .click();
      }
      await page.getByRole("button", { name: /Check/ }).click();
      return;
    }
    case "ORDER_EVENTS": {
      const events = content.events as { id: string; text: string }[];
      const expected = answerSpec.acceptedSequences![0];
      for (const id of correct ? expected : [...expected].reverse()) {
        await page
          .getByRole("list", { name: "Events to place" })
          .getByRole("button", { name: events.find((e) => e.id === id)!.text, exact: true })
          .click();
      }
      await page.getByRole("button", { name: /Check/ }).click();
      return;
    }
    case "SORT": {
      const items = content.items as Item[];
      const groups = content.groups as { id: string; label: string }[];
      const pairs = (q.answer as { pairs: [string, string][] }).pairs;
      for (const [itemId, groupId] of pairs) {
        const target = correct ? groupId : groups.find((g) => g.id !== groupId)!.id;
        await page
          .getByRole("group", { name: "Things to sort" })
          .getByRole("button", { name: itemLabel(items.find((x) => x.id === itemId)!), exact: true })
          .click();
        await page
          .getByRole("region", { name: groups.find((g) => g.id === target)!.label, exact: true })
          .getByRole("button")
          .first()
          .click();
      }
      await page.getByRole("button", { name: /Check/ }).click();
      return;
    }
    case "DRAG_DROP": {
      const bank = content.bank as string[];
      const expected = answerSpec.acceptedSequences![0];
      const words = correct ? expected : expected.map((w) => bank.find((b) => b !== w)!);
      for (const word of words) {
        await page
          .getByRole("group", { name: "Word bank" })
          .getByRole("button", { name: word, exact: true })
          .click();
      }
      await page.getByRole("button", { name: /Check/ }).click();
      return;
    }
    case "WRITING": {
      const starter = ((content.starter as string | undefined) ?? "").trim();
      const full = answerSpec.accepted![0];
      const typed = starter && full.startsWith(starter) ? full.slice(starter.length).trim() : full;
      await page.locator(`#write-${q.id}`).fill(correct ? typed : "zzz");
      await page.getByRole("button", { name: /Check/ }).click();
      return;
    }
    case "TRACING": {
      // Draw the glyph's own strokes (from the database) with the mouse, in order; a wrong
      // answer is a short mark in the corner.
      const canvas = page.getByTestId("tracing-canvas");
      const box = (await canvas.boundingBox())!;
      const { data: glyph } = await admin
        .from("handwriting_glyphs")
        .select("strokes")
        .eq("code", content.glyph)
        .single();
      const strokes = correct
        ? (glyph!.strokes as { points: [number, number][] }[]).map((s) => s.points)
        : [
            [
              [3, 3],
              [3, 25],
            ],
          ];
      const at = ([x, y]: number[]) =>
        [box.x + (x / 100) * box.width, box.y + (y / 100) * box.height] as const;
      for (const points of strokes) {
        await page.mouse.move(...at(points[0]));
        await page.mouse.down();
        for (let i = 1; i < points.length; i++) await page.mouse.move(...at(points[i]), { steps: 4 });
        await page.mouse.up();
      }
      await page.getByRole("button", { name: /Done/ }).click();
      return;
    }
    case "SENTENCE_WRITING":
    case "GUIDED_WRITING":
    case "STORY_ORDER_WRITING":
    case "EDIT_AND_CORRECT": {
      const response = (
        correct
          ? correctWritingResponse
          : (t: string, c: Record<string, unknown>) => wrongWritingResponse(t, c)
      )(q.question_type, content, q.answer as Record<string, unknown>, null) as {
        value?: string;
        lines?: string[];
        order?: string[];
      };
      const section = page.locator("section[data-question-id]");
      if (q.question_type === "STORY_ORDER_WRITING") {
        const events = content.events as { id: string; emoji: string; label: string }[];
        for (const id of response.order!) {
          const e = events.find((x) => x.id === id)!;
          await section
            .getByRole("button", { name: `Add picture: ${e.label || e.emoji}`, exact: true })
            .click();
        }
        for (const [i, line] of response.lines!.entries())
          await section.getByLabel(new RegExp(`^Sentence for picture ${i + 1}`)).fill(line);
      } else if (q.question_type === "GUIDED_WRITING") {
        const boxes = section.locator("textarea, input[type!=hidden]");
        for (const [i, line] of response.lines!.entries()) await boxes.nth(i).fill(line);
      } else {
        await section.locator("textarea, input").first().fill(response.value!);
      }
      await section.getByRole("button", { name: /Check/ }).click();
      return;
    }
    default:
      throw new Error(`no automation for ${q.question_type}`);
  }
}

export async function waitForSynced(page: Page) {
  // The child/parent layouts flush the outbox; wait until nothing is pending locally.
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const request = indexedDB.open("english-learning");
              request.onsuccess = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains("outbox")) return resolve(0);
                const count = db.transaction("outbox").objectStore("outbox").count();
                count.onsuccess = () => resolve(count.result);
              };
              request.onerror = () => resolve(-1);
            }),
        ),
      { timeout: 30_000 },
    )
    .toBe(0);
}

type Item = { id: string; text?: string; emoji?: string; speech?: string };
const itemLabel = (item: Item) => item.text ?? item.speech ?? item.emoji ?? item.id;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A wrong spelling the child could have written: the letters reversed (or rotated).
export function wrongSpelling(word: string) {
  const reversed = [...word].reverse().join("");
  return reversed !== word ? reversed : word.slice(1) + word[0] + "x";
}

// Writes a spelling with whatever input the step offers (spelling.ts → input methods):
// the device keyboard, the child's on-screen keyboard, or letter tiles.
export async function writeSpelling(page: Page, text: string, tiles?: string[], sentence = false) {
  const section = page.locator("section[data-question-id]");
  const method = await section.locator("[data-input-method]").first().getAttribute("data-input-method");
  if (method === "KEYBOARD") {
    await section.getByLabel(sentence ? "Write the sentence" : "Type the word").fill(text);
  } else if (method === "ON_SCREEN_KEYBOARD") {
    const keyboard = section.getByRole("group", { name: "Keyboard" });
    for (const ch of text) {
      if (/[A-Z]/.test(ch)) await keyboard.getByRole("button", { name: "Capital letter next" }).click();
      const name =
        ch === " "
          ? "space"
          : ch === "'"
            ? "apostrophe"
            : ch === "."
              ? "full stop"
              : ch === "?"
                ? "question mark"
                : ch === "!"
                  ? "exclamation mark"
                  : ch === ","
                    ? "comma"
                    : ch.toLowerCase();
      await keyboard.getByRole("button", { name, exact: true }).click();
    }
  } else {
    // Letter tiles: wrong answers use the word's own tiles in another order.
    const pool = [...(tiles ?? [])];
    for (const ch of text) {
      const i = pool.indexOf(ch);
      if (i === -1) continue;
      pool.splice(i, 1);
      await section
        .getByRole("group", { name: "Tiles" })
        .getByRole("button", { name: ch, exact: true })
        .first()
        .click();
    }
  }
  await section.getByRole("button", { name: /Check/ }).click();
}
