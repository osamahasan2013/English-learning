import { expect, test, type Page } from "@playwright/test";
import {
  addChild,
  admin,
  lessonQuestions,
  passParentGate,
  playLesson,
  registerParent,
  startLesson,
  waitForSynced,
} from "./helpers";

// Phase 10.1 — automated accessibility audit of the parent experience with axe-core (the
// engine behind most accessibility checkers), on a signed-in parent with real data: two
// children, a finished lesson, a waiting check. Every parent page is audited against WCAG
// 2.0/2.1 A and AA plus axe best practices (names, ARIA, landmarks, headings, labels,
// duplicate ids, colour contrast), in light and dark mode, and with the reset / delete
// dialogs open. Then keyboard use: skip link, child selector, Start, collapsible sections
// and dialogs, with a visible focus ring. No rule is disabled.

const axePath = require.resolve("axe-core/axe.min.js");

type AxeResult = {
  violations: {
    id: string;
    impact: string | null;
    help: string;
    nodes: { target: string[]; failureSummary?: string }[];
  }[];
  incomplete: { id: string; nodes: unknown[] }[];
  passes: { id: string }[];
};

async function audit(page: Page, label: string, context = "html") {
  await page.addScriptTag({ path: axePath });
  const result = (await page.evaluate(async (selector) => {
    const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<unknown> } }).axe;
    return axe.run(document.querySelector(selector), {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] },
      resultTypes: ["violations", "incomplete", "passes"],
    });
  }, context)) as AxeResult;
  const summary = result.violations.map(
    (v) =>
      `${label}: [${v.impact}] ${v.id} — ${v.help}\n` +
      v.nodes
        .slice(0, 5)
        .map((n) => `    ${n.target.join(" ")}\n      ${(n.failureSummary ?? "").replace(/\n/g, "\n      ")}`)
        .join("\n"),
  );
  expect.soft(summary, summary.join("\n")).toEqual([]);
  // axe's "needs review" items fail too, except colour contrast it cannot compute: text
  // only made of decorative icons (aria-hidden, next to a written label) and navigation links
  // at the edge of the scrollable nav row. Those colours are the theme tokens, all checked
  // at WCAG AA in docs/architecture.md → "Accessibility audit".
  expect
    .soft(
      result.incomplete.filter((i) => i.id !== "color-contrast").map((i) => i.id),
      `${label}: axe needs review`,
    )
    .toEqual([]);
  // What axe could not decide on its own is logged.
  const unsure = result.incomplete.map((i) => `${i.id}×${i.nodes.length}`);
  if (unsure.length) console.info(`axe needs review — ${label}: ${unsure.join(", ")}`);
  return result;
}

const PAGES = [
  "/parent/dashboard",
  "/parent/progress",
  "/parent/practice",
  "/parent/assessments",
  "/parent/phonics",
  "/parent/words",
  "/parent/spelling",
  "/parent/reading",
  "/parent/writing",
  "/parent/children",
];

async function fixture(page: Page) {
  await registerParent(page, "A11y Parent");
  const maya = await addChild(page, "Maya", /Kindergarten 3/);
  await page.goto("/parent/children/new");
  await addChild(page, "Omar", /Grade 1/);
  // Maya finishes the recommended lesson, so recent learning, skills and next steps exist.
  await page.goto(`/parent/practice?child=${maya}`);
  await page
    .getByRole("button", { name: /Start .* as Maya/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/child\/learn\//);
  const lessonId = page.url().split("/child/learn/")[1];
  const { data } = await admin.from("lessons").select("code").eq("id", lessonId).single();
  const { questions } = await lessonQuestions(data!.code);
  await startLesson(page);
  await playLesson(page, questions, true);
  await waitForSynced(page);
  await page.goto("/child/home");
  await passParentGate(page);
  // A waiting check, so the checks page shows its cancel control.
  await page.goto(`/parent/assessments?child=${maya}`);
  await page
    .getByRole("listitem")
    .filter({ has: page.getByText("Phonics Check", { exact: true }) })
    .getByRole("button", { name: "Start" })
    .click();
  await expect(page.getByText(/The check is ready/)).toBeVisible();
  return maya;
}

test("every parent page passes axe (WCAG 2.1 A/AA + best practice) in light and dark mode", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const maya = await fixture(page);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const path of PAGES) {
      await page.goto(path === "/parent/children" ? path : `${path}?child=${maya}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      // Open every collapsible section so its content is audited too.
      await page
        .locator("#main details")
        .evaluateAll((all) => all.forEach((d) => ((d as HTMLDetailsElement).open = true)));
      await audit(page, `${path} (${scheme})`);
    }
  }
  // The destructive dialogs, open.
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`/parent/children/${maya}`);
  await audit(page, "child settings");
  await page.getByRole("button", { name: "Reset Maya's learning…" }).click();
  await expect(page.getByRole("dialog", { name: "Reset learning for Maya?" })).toBeVisible();
  await audit(page, "reset dialog");
  await audit(page, "reset dialog (dialog only)", "dialog[open]");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Delete Maya…" }).click();
  await expect(page.getByRole("dialog", { name: "Delete Maya permanently?" })).toBeVisible();
  await audit(page, "delete dialog");
  await audit(page, "delete dialog (dialog only)", "dialog[open]");

  // Canary: the audit really runs and really fails on a violation (an unnamed button and a
  // low-contrast text), so a clean result above means something.
  await page.keyboard.press("Escape");
  await page.addScriptTag({ path: axePath });
  const canary = (await page.evaluate(async () => {
    document
      .querySelector("#main")!
      .insertAdjacentHTML(
        "beforeend",
        '<button id="canary-a"></button><p id="canary-b" style="color:#bbb;background:#fff">faint text</p>',
      );
    const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<unknown> } }).axe;
    return axe.run(document, { runOnly: { type: "rule", values: ["button-name", "color-contrast"] } });
  })) as AxeResult;
  expect(canary.violations.map((v) => v.id).sort()).toEqual(["button-name", "color-contrast"]);
});

async function focusRing(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const style = getComputedStyle(el);
    return {
      tag: el.tagName,
      text: (el.textContent ?? "").trim().slice(0, 60),
      outline: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2,
    };
  });
}

test("the parent pages work from the keyboard with a visible focus ring", async ({ page }) => {
  test.setTimeout(300_000);
  const maya = await fixture(page);

  // Skip link first, then into the main content.
  await page.goto(`/parent/dashboard?child=${maya}`);
  await page.keyboard.press("Tab");
  expect(await focusRing(page)).toMatchObject({ text: "Skip to content", outline: true });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);

  // Every focusable control in the main area shows the focus ring, and the child selector
  // and Start buttons are reachable by Tab alone.
  const seen: string[] = [];
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    const f = await focusRing(page);
    if (!f) continue;
    expect(f.outline, `focus ring on ${f.tag} "${f.text}"`).toBe(true);
    seen.push(f.text);
  }
  expect(seen.some((t) => /^🦉 Omar/.test(t))).toBe(true);
  expect(seen.some((t) => /^▶ Start .+ as Maya$/.test(t))).toBe(true);

  // The child selector switches child from the keyboard.
  await page.getByRole("navigation", { name: "Choose a child" }).getByRole("link", { name: /Omar/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Omar" })).toBeVisible();

  // Collapsible sections open and close with the keyboard.
  await page.goto(`/parent/reading?child=${maya}`);
  const summary = page.locator("#main details > summary").first();
  await summary.focus();
  expect((await focusRing(page))?.outline).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.locator("#main details").first()).toHaveAttribute("open", "");
  await page.keyboard.press("Enter");
  await expect(page.locator("#main details").first()).not.toHaveAttribute("open", "");

  // The reset dialog: focus moves into it, Escape closes it and returns focus to its button.
  await page.goto(`/parent/children/${maya}`);
  const trigger = page.getByRole("button", { name: "Reset Maya's learning…" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Reset learning for Maya?" });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  // Start from the keyboard hands the device to the child, straight into the lesson.
  await page.goto(`/parent/practice?child=${maya}`);
  await page
    .getByRole("button", { name: /Start .* as Maya/ })
    .first()
    .focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/child\/learn\//);
});

test("the learning-time chart has a text equivalent and states never rely on colour alone", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const maya = await fixture(page);
  await page.goto(`/parent/progress?child=${maya}`);
  const chart = page.getByRole("heading", { name: /Daily learning time/ }).locator("..");
  // The bars are hidden from assistive technology; a table carries the same numbers.
  await expect(chart.locator("table")).toHaveCount(1);
  await expect(chart.locator("table")).toContainText(/min/);
  // Area states and skill statuses are written in words next to any icon or colour.
  const areas = page.getByRole("list", { name: "Progress by area" });
  await expect(areas).toContainText(
    /Not enough evidence yet|Limited evidence|Needs review|Learning|Practising|Almost there|Mastered/,
  );
  for (const icon of await page.locator("#main [aria-hidden]").all())
    expect(await icon.evaluate((el) => el.closest("[aria-hidden='false']"))).toBeNull();
});
