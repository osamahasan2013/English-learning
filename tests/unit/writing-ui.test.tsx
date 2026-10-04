import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SpeakFn } from "@/lib/audio/audio-service";
import { EditAndCorrectRenderer } from "@/features/activities/renderers/edit-correct";
import { GuidedWritingRenderer } from "@/features/activities/renderers/guided-writing";
import { SentenceWritingRenderer } from "@/features/activities/renderers/sentence-writing";
import { StoryOrderWritingRenderer } from "@/features/activities/renderers/story-writing";
import { TracingRenderer } from "@/features/activities/renderers/tracing";
import { ACTIVITY_RENDERERS } from "@/features/activities/registry";
import { WritingFeedback } from "@/features/lesson-player/writing-feedback";
import type { LessonStep } from "@/lib/learning/lesson-payload";
import { resolveWritingSettings } from "@/lib/learning/writing-evaluation";
import { glyphByCode } from "../writing-helpers";

// The writing renderers: handwriting on a canvas (pointer events from a finger, mouse or
// pen) with undo, clear and a typed alternative; typed sentences with a word bank and the
// writing checklist; guided frames; story ordering with a sentence per picture; editing.
// Renderers only report what the child did — they never decide whether it is right.

const speak: SpeakFn = vi.fn(async () => "played" as const);

function step(question: LessonStep["question"], extra: Partial<LessonStep> = {}): LessonStep {
  return {
    questionId: "q1",
    questionVersion: 1,
    activityId: "a1",
    activityTitle: "Write",
    instructions: "",
    instructionsSpeech: "",
    stage: "guided_practice",
    prompt: "",
    promptSpeech: "",
    skillId: "s1",
    wordId: null,
    scored: true,
    question,
    answerKey: { mode: "none" },
    maxTries: 2,
    explanation: "",
    activityConfig: {},
    passage: null,
    pattern: null,
    tileSounds: {},
    spelling: null,
    writing: resolveWritingSettings("GRADE1"),
    ...extra,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const props = (s: LessonStep, onAnswer = vi.fn()): any => ({
  step: s,
  phase: "answering",
  lastResponse: null,
  reveal: null,
  onAnswer,
  speak,
});

describe("registry", () => {
  it("has a renderer for every writing question type", () => {
    for (const type of [
      "TRACING",
      "SENTENCE_WRITING",
      "GUIDED_WRITING",
      "STORY_ORDER_WRITING",
      "EDIT_AND_CORRECT",
    ] as const)
      expect(ACTIVITY_RENDERERS[type], type).toBeTypeOf("function");
  });
});

describe("TracingRenderer", () => {
  const glyph = glyphByCode("lower-l")!;
  const tracing = step(
    { type: "TRACING", content: { glyph: "lower-l", mode: "trace", showStart: true } },
    { glyph, activityConfig: { showModel: true } },
  );

  it("records strokes from pointer events in the glyph's box, with undo and clear", async () => {
    const onAnswer = vi.fn();
    render(<TracingRenderer {...props(tracing, onAnswer)} />);
    const canvas = screen.getByTestId("tracing-canvas");
    canvas.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 200,
      height: 200,
      right: 200,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    canvas.setPointerCapture = () => {};
    const draw = (from: [number, number], to: [number, number]) => {
      fireEvent.pointerDown(canvas, { clientX: from[0], clientY: from[1], pointerId: 1 });
      for (let i = 1; i <= 10; i++)
        fireEvent.pointerMove(canvas, {
          clientX: from[0] + ((to[0] - from[0]) * i) / 10,
          clientY: from[1] + ((to[1] - from[1]) * i) / 10,
          pointerId: 1,
        });
      fireEvent.pointerUp(canvas, { pointerId: 1 });
    };
    const done = screen.getByRole("button", { name: /Done/ });
    expect(done).toBeDisabled();
    draw([100, 30], [100, 160]);
    draw([20, 20], [40, 40]);
    await userEvent.click(screen.getByRole("button", { name: /Undo/ }));
    await userEvent.click(done);
    const response = onAnswer.mock.calls[0][0] as { strokes: number[][][] };
    expect(response.strokes).toHaveLength(1);
    expect(response.strokes[0][0]).toEqual([50, 15]);
    expect(response.strokes[0].at(-1)).toEqual([50, 80]);
    expect(response.strokes.flat(2).every(Number.isInteger)).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: /Clear/ }));
    expect(screen.getByRole("button", { name: /Done/ })).toBeDisabled();
  });

  it("offers a typed alternative for children who cannot draw on the screen", async () => {
    const onAnswer = vi.fn();
    render(<TracingRenderer {...props(tracing, onAnswer)} />);
    await userEvent.click(screen.getByRole("button", { name: /Type it/ }));
    await userEvent.type(screen.getByLabelText(/Type small l/), "l");
    await userEvent.click(screen.getByRole("button", { name: /Check/ }));
    expect(onAnswer).toHaveBeenCalledWith({ strokes: [], typed: "l" });
  });

  it("hides the letter in write mode and shows it in copy mode", () => {
    const { unmount } = render(
      <TracingRenderer
        {...props(
          step(
            { type: "TRACING", content: { glyph: "lower-l", mode: "write", showStart: false } },
            { glyph },
          ),
        )}
      />,
    );
    expect(screen.queryByRole("img", { name: "small l" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Show me/ })).toBeNull();
    unmount();
    render(
      <TracingRenderer
        {...props(
          step({ type: "TRACING", content: { glyph: "lower-l", mode: "copy", showStart: true } }, { glyph }),
        )}
      />,
    );
    expect(screen.getByRole("img", { name: "small l" })).toBeInTheDocument();
  });
});

describe("SentenceWritingRenderer", () => {
  it("copies a model sentence and ticks the checklist as the child writes", async () => {
    const onAnswer = vi.fn();
    render(
      <SentenceWritingRenderer
        {...props(
          step({
            type: "SENTENCE_WRITING",
            content: { mode: "copy", model: "The cat is big.", wordBank: [] },
          }),
          onAnswer,
        )}
      />,
    );
    expect(screen.getByTestId("model-sentence")).toHaveTextContent("The cat is big.");
    const box = screen.getByLabelText("Write the sentence here");
    expect(box).toHaveAttribute("autocapitalize", "none");
    await userEvent.type(box, "The cat is big.");
    const checklist = screen.getByRole("region", { name: /My writing checklist/ });
    expect(within(checklist).getAllByText("(done)")).toHaveLength(3);
    await userEvent.click(screen.getByRole("button", { name: /Check/ }));
    expect(onAnswer).toHaveBeenCalledWith({ value: "The cat is big." });
  });

  it("finishes a sentence with the missing word only", async () => {
    const onAnswer = vi.fn();
    render(
      <SentenceWritingRenderer
        {...props(
          step({
            type: "SENTENCE_WRITING",
            content: {
              mode: "complete",
              parts: [{ text: "I see a" }, { blank: true }, { text: "." }],
              wordBank: [],
            },
          }),
          onAnswer,
        )}
      />,
    );
    await userEvent.type(screen.getByLabelText("The missing word"), "dog");
    await userEvent.click(screen.getByRole("button", { name: /Check/ }));
    expect(onAnswer).toHaveBeenCalledWith({ value: "dog" });
  });

  it("free writing: the word bank adds words; no checklist when mechanics are off (KG1)", async () => {
    const onAnswer = vi.fn();
    render(
      <SentenceWritingRenderer
        {...props(
          step(
            { type: "SENTENCE_WRITING", content: { mode: "free", wordBank: ["dog", "runs"] } },
            { writing: resolveWritingSettings("KG1") },
          ),
          onAnswer,
        )}
      />,
    );
    const bank = screen.getByRole("group", { name: "Word bank" });
    await userEvent.click(within(bank).getByRole("button", { name: "dog" }));
    await userEvent.click(within(bank).getByRole("button", { name: "runs" }));
    expect(screen.queryByRole("region", { name: /checklist/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Check/ }));
    expect(onAnswer).toHaveBeenCalledWith({ value: "dog runs" });
  });
});

describe("GuidedWritingRenderer", () => {
  it("one box per frame, starters shown, answers sent as lines", async () => {
    const onAnswer = vi.fn();
    render(
      <GuidedWritingRenderer
        {...props(
          step({
            type: "GUIDED_WRITING",
            content: {
              layout: "frames",
              topic: "My pet",
              frames: [{ starter: "I have a" }, { starter: "It is" }],
              wordBank: ["cat"],
              checklist: ["Tell about your pet"],
            },
          }),
          onAnswer,
        )}
      />,
    );
    expect(screen.getByText("I have a")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Sentence 1: I have a/), "cat.");
    await userEvent.type(screen.getByLabelText(/Sentence 2: It is/), "soft.");
    expect(screen.getByText("Tell about your pet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Check/ }));
    expect(onAnswer).toHaveBeenCalledWith({ lines: ["cat.", "soft."] });
  });
});

describe("StoryOrderWritingRenderer", () => {
  it("orders pictures by tapping, keeps each sentence with its picture, and reports both", async () => {
    const onAnswer = vi.fn();
    render(
      <StoryOrderWritingRenderer
        {...props(
          step(
            {
              type: "STORY_ORDER_WRITING",
              content: {
                events: [
                  { id: "b", emoji: "🐣", label: "Hatch" },
                  { id: "a", emoji: "🥚", label: "Egg" },
                ],
                connect: false,
                wordBank: [],
                starters: ["First,", "Then"],
              },
            },
            { activityConfig: { showStory: false } },
          ),
          onAnswer,
        )}
      />,
    );
    const check = screen.getByRole("button", { name: /Check/ });
    expect(check).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Add picture: Egg" }));
    await userEvent.click(screen.getByRole("button", { name: "Add picture: Hatch" }));
    await userEvent.type(screen.getByLabelText(/Sentence for picture 1/), "there is an egg.");
    await userEvent.type(screen.getByLabelText(/Sentence for picture 2/), "it hatched.");
    await userEvent.click(check);
    expect(onAnswer).toHaveBeenCalledWith({ order: ["a", "b"], lines: ["there is an egg.", "it hatched."] });
  });
});

describe("EditAndCorrectRenderer", () => {
  it("starts from the sentence with mistakes and sends the corrected text", async () => {
    const onAnswer = vi.fn();
    render(
      <EditAndCorrectRenderer
        {...props(
          step({
            type: "EDIT_AND_CORRECT",
            content: { text: "the cat is big", focus: ["capitalization", "punctuation"] },
          }),
          onAnswer,
        )}
      />,
    );
    const box = screen.getByLabelText("Write the sentence correctly");
    expect(box).toHaveValue("the cat is big");
    expect(screen.getByRole("list", { name: "Look for" })).toHaveTextContent(/Capital letters.*End marks/);
    await userEvent.clear(box);
    await userEvent.type(box, "The cat is big.");
    await userEvent.click(screen.getByRole("button", { name: /Check/ }));
    expect(onAnswer).toHaveBeenCalledWith({ value: "The cat is big." });
  });
});

describe("WritingFeedback", () => {
  it("lists the checks with icons and words (never colour alone), must-haves first", () => {
    render(
      <WritingFeedback
        correct={false}
        analysis={{
          v: 1,
          kind: "rubric",
          words: 3,
          sentences: 1,
          criteria: [
            {
              id: "spelling",
              dimension: "spelling",
              label: "Words spelled well",
              hint: "",
              critical: false,
              met: null,
            },
            {
              id: "end",
              dimension: "punctuation",
              label: "End mark",
              hint: "End each sentence with . ! or ?",
              critical: true,
              met: false,
            },
            {
              id: "words",
              dimension: "words",
              label: "Three or more words",
              hint: "",
              critical: true,
              met: true,
            },
          ],
        }}
      />,
    );
    const items = within(screen.getByTestId("writing-feedback")).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent(/End mark — not yet/);
    expect(items[0]).toHaveTextContent("End each sentence with . ! or ?");
    expect(items[1]).toHaveTextContent(/Three or more words — done/);
    expect(items[2]).toHaveTextContent(/not checked/);
  });
});
