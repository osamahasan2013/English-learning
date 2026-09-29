import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

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

// Plays the lesson currently on screen to the end. `correct` answers every question
// correctly on the first try; otherwise every first try is wrong.
export async function playLesson(page: Page, questions: Map<string, QuestionRow>, correct: boolean) {
  for (let guard = 0; guard < 200; guard++) {
    if (await page.getByText(/You finished/).isVisible()) return;
    const section = page.locator("section[data-question-id]");
    await section.waitFor();
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
    await answer(page, q, correct);
    await page.waitForTimeout(50);
  }
  throw new Error("lesson did not finish");
}

async function answer(page: Page, q: QuestionRow, correct: boolean) {
  const content = q.content as Record<string, never>;
  const answerSpec = q.answer as { accepted?: string[]; acceptedSequences?: string[][] };
  switch (q.question_type) {
    case "MULTIPLE_CHOICE":
    case "LISTEN_AND_CHOOSE":
    case "PICTURE_MATCH": {
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
    case "SPELLING":
      await page.getByLabel("Type the word").fill(correct ? answerSpec.accepted![0] : "zzz");
      await page.getByRole("button", { name: /Check/ }).click();
      return;
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
