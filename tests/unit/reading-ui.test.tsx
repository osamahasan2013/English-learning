import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AudioRequest, PlayOptions, SpeakFn } from "@/lib/audio/audio-service";
import { OrderEventsRenderer } from "@/features/activities/renderers/order-events";
import { ReadPassageRenderer } from "@/features/activities/renderers/read-passage";
import { SelectAllRenderer } from "@/features/activities/renderers/select-all";
import type { ReadingReport, RendererProps } from "@/features/activities/types";
import { PassageView } from "@/features/reading/passage-view";
import type { LessonStep, ReadingPassage } from "@/lib/learning/lesson-payload";
import { paragraphsOf } from "@/lib/learning/reading";

// The reading UI: the passage reader (sentence and word highlighting from the audio
// sequence, tap a word to hear it and report it as a help word), guided reading reporting
// one honest session, and the select-all and ordering renderers.

const passage: ReadingPassage = {
  storyId: "story-1",
  code: "the-big-cat",
  title: "The Big Cat",
  contentType: "SHORT_STORY",
  contentTypeName: "Short story",
  emoji: "🐱",
  image: null,
  audioUrl: null,
  paragraphs: paragraphsOf([{ text: "I see a cat. The cat is big." }, { text: "It naps.", speaker: "Mom" }]),
  words: { cat: "w-cat", big: "w-big", naps: "w-nap" },
  focusWords: ["cat"],
  wordCount: 11,
  estimatedSeconds: 30,
};

// A speech engine double: records every request and lets the test drive onItem.
function fakeSpeak() {
  const calls: { requests: AudioRequest[]; options?: Omit<PlayOptions, "sounds"> }[] = [];
  const speak: SpeakFn = vi.fn(async (text, speed = "normal", options) => {
    calls.push({ requests: typeof text === "string" ? [{ text, speed }] : text, options });
    return "played" as const;
  });
  return { speak, calls };
}

function step(question: LessonStep["question"], extra: Partial<LessonStep> = {}): LessonStep {
  return {
    questionId: "q1",
    questionVersion: 1,
    activityId: "a1",
    activityTitle: "Read",
    instructions: "",
    instructionsSpeech: "",
    stage: "guided_practice",
    prompt: "Read the story",
    promptSpeech: "",
    skillId: "s1",
    wordId: null,
    scored: question.type !== "READ_PASSAGE",
    question,
    answerKey: { mode: "none" },
    maxTries: 2,
    explanation: "",
    activityConfig: { story: "the-big-cat" },
    passage,
    pattern: null,
    tileSounds: {},
    spelling: null,
    ...extra,
  };
}

// Each renderer narrows RendererProps to its own question type (as the registry does).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function props(s: LessonStep, over: Partial<RendererProps> = {}): RendererProps<any> {
  return {
    step: s,
    phase: "answering",
    lastResponse: null,
    reveal: null,
    onAnswer: vi.fn(),
    speak: fakeSpeak().speak,
    ...over,
  };
}

describe("PassageView", () => {
  it("reads sentence by sentence and highlights the sentence being read", async () => {
    const { speak, calls } = fakeSpeak();
    render(<PassageView passage={passage} speak={speak} />);
    await userEvent.click(screen.getByRole("button", { name: /Listen/ }));
    expect(calls[0].requests.map((r) => r.text)).toEqual(["I see a cat.", "The cat is big.", "It naps."]);
    act(() => calls[0].options?.onItem?.(1));
    const active = document.querySelector('[data-sentence="1"]')!;
    expect(active.className).toMatch(/underline/);
    expect(document.querySelector('[data-sentence="0"]')!.className).not.toMatch(/underline/);
  });

  it("points at the words being said when the level reads in phrases or word by word", async () => {
    const { speak, calls } = fakeSpeak();
    render(<PassageView passage={passage} speak={speak} highlight="word" />);
    await userEvent.click(screen.getByRole("button", { name: /Slow/ }));
    // Sentences go to the audio service, which reads them in the level's pieces.
    expect(calls[0].requests.map((r) => [r.text, r.speed, r.intent])).toEqual([
      ["I see a cat.", "slow", "STORY_READING"],
      ["The cat is big.", "slow", "STORY_READING"],
      ["It naps.", "slow", "STORY_READING"],
    ]);
    // The service reports the piece being said: "cat" (word 3 of the first sentence).
    act(() => calls[0].options?.onChunk?.(0, { start: 3, count: 1 }));
    const first = within(document.querySelector('[data-sentence="0"]') as HTMLElement);
    expect(first.getByRole("button", { name: "cat" }).className).toMatch(/bg-primary/);
    expect(first.getByRole("button", { name: "see" }).className).not.toMatch(/bg-primary/);
    // A piece that is the whole sentence highlights the sentence, no single word.
    act(() => calls[0].options?.onChunk?.(1, { start: 0, count: 4 }));
    const second = within(document.querySelector('[data-sentence="1"]') as HTMLElement);
    expect(second.getByRole("button", { name: "big" }).className).not.toMatch(/bg-primary/);
  });

  it("a tapped word is said and reported with its word id", async () => {
    const { speak, calls } = fakeSpeak();
    const onWordHelp = vi.fn();
    render(<PassageView passage={passage} speak={speak} onWordHelp={onWordHelp} />);
    await userEvent.click(screen.getByRole("button", { name: "naps" }));
    expect(calls.at(-1)!.requests).toEqual([{ text: "naps", speed: "slow" }]);
    expect(onWordHelp).toHaveBeenCalledWith("w-nap", "naps");
    await userEvent.click(screen.getAllByRole("button", { name: "I" })[0]);
    expect(onWordHelp).toHaveBeenLastCalledWith(null, "i");
  });

  it("shows the speaker of a dialogue line and points at the answer sentence", () => {
    render(
      <PassageView
        passage={passage}
        speak={fakeSpeak().speak}
        pointTo={{ paragraph: 0, sentence: 1 }}
        compact
      />,
    );
    expect(screen.getByText("Mom:")).toBeInTheDocument();
    expect(screen.getByText("The answer is here:")).toBeInTheDocument();
    // Compact (a question's look-back panel) has no Listen buttons of its own.
    expect(screen.queryByRole("button", { name: /Listen/ })).toBeNull();
  });

  it("plays a whole-text recording when there is one", async () => {
    const { speak, calls } = fakeSpeak();
    render(<PassageView passage={{ ...passage, audioUrl: "https://x/story.mp3" }} speak={speak} />);
    await userEvent.click(screen.getByRole("button", { name: /Listen/ }));
    expect(calls[0].requests).toHaveLength(1);
    expect(calls[0].requests[0].assetUrl).toBe("https://x/story.mp3");
  });
});

describe("ReadPassageRenderer", () => {
  const question = {
    type: "READ_PASSAGE",
    content: { mode: "listen_first", highlight: "sentence", selfCheck: true },
  } as const;

  it("reports one session on leaving, with listens, help words, re-reads and the self-check", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onReading = vi.fn<(r: ReadingReport) => void>();
    const view = render(<ReadPassageRenderer {...props(step(question))} onReading={onReading} />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: /Listen/ }));
    await user.click(screen.getByRole("button", { name: "big" }));
    await user.click(screen.getByRole("button", { name: /I read it/ }));
    await user.click(screen.getByRole("button", { name: /OK/ }));
    await user.click(screen.getByRole("button", { name: /Read it again/ }));
    vi.advanceTimersByTime(5000);
    expect(onReading).not.toHaveBeenCalled();
    view.unmount();
    expect(onReading).toHaveBeenCalledTimes(1);
    const report = onReading.mock.calls[0][0];
    expect(report).toMatchObject({
      storyId: "story-1",
      mode: "listen_first",
      listens: 1,
      slowListens: 0,
      rereads: 1,
      helpWordIds: ["w-big"],
      selfCheck: "ok",
    });
    expect(report.durationMs).toBeGreaterThanOrEqual(5000);
    expect(Object.keys(report).join()).not.toMatch(/score|wpm|correct/i);
    vi.useRealTimers();
  });

  it("does not report a text that was only flashed past", () => {
    const onReading = vi.fn();
    const view = render(<ReadPassageRenderer {...props(step(question))} onReading={onReading} />);
    view.unmount();
    expect(onReading).not.toHaveBeenCalled();
  });

  it("is skipped gracefully when the story is not available", () => {
    render(<ReadPassageRenderer {...props(step(question, { passage: null }))} />);
    expect(screen.getByText(/skip this one/)).toBeInTheDocument();
  });
});

describe("SelectAllRenderer", () => {
  const question = {
    type: "SELECT_ALL",
    content: {
      options: [
        { id: "goat", text: "goat" },
        { id: "sheep", text: "sheep" },
        { id: "snail", text: "snail" },
      ],
    },
  } as const;

  it("toggles choices (shown with a tick, not only colour) and checks them together", async () => {
    const onAnswer = vi.fn();
    render(<SelectAllRenderer {...props(step(question as never))} onAnswer={onAnswer} />);
    const check = screen.getByRole("button", { name: "Check" });
    expect(check).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "goat" }));
    await userEvent.click(screen.getByRole("button", { name: "snail" }));
    await userEvent.click(screen.getByRole("button", { name: "snail" }));
    await userEvent.click(screen.getByRole("button", { name: "sheep" }));
    expect(screen.getByRole("button", { name: "goat" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "goat" })).toHaveTextContent("✓");
    await userEvent.click(check);
    expect(onAnswer).toHaveBeenCalledWith({ sequence: ["goat", "sheep"] });
  });

  it("marks right and wrong choices in words after the answer is shown", () => {
    render(
      <SelectAllRenderer
        {...props(step(question as never), {
          phase: "reveal",
          lastResponse: { sequence: ["goat", "snail"] },
          reveal: { text: "goat, sheep", sequence: ["goat", "sheep"] },
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "goat (right answer)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "sheep (right answer)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "snail (not right)" })).toBeInTheDocument();
  });
});

describe("OrderEventsRenderer", () => {
  const question = {
    type: "ORDER_EVENTS",
    content: {
      events: [
        { id: "e2", text: "Sam saw a shell." },
        { id: "e1", text: "Sam saw a ship." },
        { id: "e3", text: "Sam put it in his bag." },
      ],
    },
  } as const;

  it("places events into numbered slots, lets one be taken back, and checks the order", async () => {
    const onAnswer = vi.fn();
    render(<OrderEventsRenderer {...props(step(question as never))} onAnswer={onAnswer} />);
    const toPlace = screen.getByRole("list", { name: "Events to place" });
    await userEvent.click(within(toPlace).getByRole("button", { name: /saw a ship/ }));
    await userEvent.click(within(toPlace).getByRole("button", { name: /saw a shell/ }));
    expect(screen.getByRole("button", { name: /^2: Sam saw a shell/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^2: Sam saw a shell/ }));
    await userEvent.click(within(toPlace).getByRole("button", { name: /his bag/ }));
    await userEvent.click(
      within(screen.getByRole("list", { name: "Events to place" })).getByRole("button", {
        name: /saw a shell/,
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(onAnswer).toHaveBeenCalledWith({ sequence: ["e1", "e3", "e2"] });
  });

  it("shows the right order with numbers after the last try", () => {
    render(
      <OrderEventsRenderer
        {...props(step(question as never), {
          phase: "reveal",
          lastResponse: { sequence: ["e2", "e1", "e3"] },
          reveal: { text: "", sequence: ["e1", "e2", "e3"] },
        })}
      />,
    );
    expect(screen.getByText(/Here is the right order/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1: Sam saw a ship." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "2: Sam saw a shell." })).toBeInTheDocument();
  });
});
