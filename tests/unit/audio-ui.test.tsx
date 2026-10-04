import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AudioControls } from "@/components/child/audio-controls";
import { ReadPassageRenderer } from "@/features/activities/renderers/read-passage";
import type { RendererProps } from "@/features/activities/types";
import { PassageView } from "@/features/reading/passage-view";
import type { AudioRequest, AudioSpeed, PlayResult, SpeakFn } from "@/lib/audio/audio-service";
import type { LessonStep, ReadingPassage } from "@/lib/learning/lesson-payload";
import { paragraphsOf } from "@/lib/learning/reading";
import { initialSessionState, sessionReducer, type SessionStep } from "@/lib/learning/lesson-session";

// The audio buttons children use (Phase 8.1): Listen, Slow, Again and Stop; the story's
// Listen / Start again / Slow / tapped word / Read it again; Try again. Each press restarts
// the words, only the latest press decides what the buttons show (an older request that is
// cut short reports back late and is ignored), and nothing silently fails.

// A speech double whose requests the test settles one by one, like real speech.
function controllableSpeak() {
  const calls: { requests: AudioRequest[]; settle: (r: PlayResult) => void }[] = [];
  const speak = (text: string | AudioRequest[], speed: AudioSpeed = "normal") =>
    new Promise<PlayResult>((resolve) => {
      calls.push({ requests: typeof text === "string" ? [{ text, speed }] : text, settle: resolve });
    });
  return { speak: speak as SpeakFn, calls };
}

const settle = async (call: { settle: (r: PlayResult) => void }, result: PlayResult) => {
  await act(async () => call.settle(result));
};

describe("AudioControls", () => {
  it("Listen, Slow and Again restart the same words at the right speed", async () => {
    const user = userEvent.setup();
    const { speak, calls } = controllableSpeak();
    render(<AudioControls text="Find the ship." speak={speak} />);
    await user.click(screen.getByRole("button", { name: "Listen" }));
    await user.click(screen.getByRole("button", { name: "Slow" }));
    await user.click(screen.getByRole("button", { name: "Again" }));
    expect(calls.map((c) => c.requests[0])).toEqual([
      { text: "Find the ship.", speed: "normal" },
      { text: "Find the ship.", speed: "slow" },
      { text: "Find the ship.", speed: "slow" },
    ]);
  });

  it("an older press reporting back late does not reset the newer one; Stop appears while playing", async () => {
    const user = userEvent.setup();
    const { speak, calls } = controllableSpeak();
    render(<AudioControls text="Find the ship." speak={speak} />);
    await user.click(screen.getByRole("button", { name: "Listen" }));
    await user.click(screen.getByRole("button", { name: "Slow" }));
    await settle(calls[0], "interrupted");
    expect(screen.getByRole("button", { name: "Stop audio" })).toBeVisible();
    await settle(calls[1], "played");
    expect(screen.queryByRole("button", { name: "Stop audio" })).toBeNull();
  });

  it("Stop ends the playing state at once", async () => {
    const user = userEvent.setup();
    const { speak, calls } = controllableSpeak();
    render(<AudioControls text="Find the ship." speak={speak} />);
    await user.click(screen.getByRole("button", { name: "Listen" }));
    await user.click(screen.getByRole("button", { name: "Stop audio" }));
    expect(screen.queryByRole("button", { name: "Stop audio" })).toBeNull();
    await settle(calls[0], "interrupted");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("tells the child when nothing could be heard, and clears it on the next press", async () => {
    const user = userEvent.setup();
    const { speak, calls } = controllableSpeak();
    render(<AudioControls text="Find the ship." speak={speak} />);
    await user.click(screen.getByRole("button", { name: "Listen" }));
    await settle(calls[0], "unavailable");
    expect(screen.getByRole("status")).toHaveTextContent("Audio isn't available right now. Try again");
    await user.click(screen.getByRole("button", { name: "Listen" }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});

const passage: ReadingPassage = {
  storyId: "story-1",
  code: "the-big-cat",
  title: "The Big Cat",
  contentType: "SHORT_STORY",
  contentTypeName: "Short story",
  emoji: "🐱",
  image: null,
  audioUrl: null,
  paragraphs: paragraphsOf([{ text: "I see a cat. The cat is big." }, { text: "It naps." }]),
  words: { cat: "w-cat", big: "w-big", naps: "w-nap" },
  focusWords: ["cat"],
  wordCount: 11,
  estimatedSeconds: 30,
};

describe("PassageView", () => {
  it("Start again restarts from the first sentence; the older reading cannot reset it", async () => {
    const user = userEvent.setup();
    const { speak, calls } = controllableSpeak();
    render(<PassageView passage={passage} speak={speak} />);
    await user.click(screen.getByRole("button", { name: "Listen" }));
    await user.click(screen.getByRole("button", { name: "Start again" }));
    expect(calls).toHaveLength(2);
    expect(calls[1].requests.map((r) => r.text)).toEqual(["I see a cat.", "The cat is big.", "It naps."]);
    await settle(calls[0], "interrupted");
    expect(screen.getByRole("button", { name: "Start again" })).toBeVisible();
    await settle(calls[1], "played");
    expect(screen.getByRole("button", { name: "Listen" })).toBeVisible();
  });

  it("Slow reads the same text slowly", async () => {
    const user = userEvent.setup();
    const { speak, calls } = controllableSpeak();
    render(<PassageView passage={passage} speak={speak} />);
    await user.click(screen.getByRole("button", { name: "Slow" }));
    expect(calls[0].requests.every((r) => r.speed === "slow")).toBe(true);
    expect(calls[0].requests[0].text).toBe("I see a cat.");
  });

  it("a tapped word ends the reading: the buttons are ready to start again", async () => {
    const user = userEvent.setup();
    const { speak, calls } = controllableSpeak();
    render(<PassageView passage={passage} speak={speak} />);
    await user.click(screen.getByRole("button", { name: "Listen" }));
    await user.click(screen.getAllByRole("button", { name: "big" })[0]);
    expect(calls[1].requests).toEqual([{ text: "big", speed: "slow" }]);
    expect(screen.getByRole("button", { name: "Listen" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Stop audio" })).toBeNull();
    // The cut-short reading reporting back late changes nothing.
    await settle(calls[0], "interrupted");
    expect(screen.getByRole("button", { name: "Listen" })).toBeVisible();
  });

  it("starts reading by itself when asked to (Read it again)", () => {
    const { speak, calls } = controllableSpeak();
    render(<PassageView passage={passage} speak={speak} autoListen="slow" />);
    expect(calls).toHaveLength(1);
    expect(calls[0].requests[0]).toEqual({ text: "I see a cat.", speed: "slow" });
  });
});

function readStep(mode: "listen_first" | "read_first"): LessonStep {
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
    scored: false,
    question: {
      type: "READ_PASSAGE",
      content: { story: "the-big-cat", mode, highlight: "sentence", selfCheck: false },
    } as LessonStep["question"],
    answerKey: { mode: "none" },
    maxTries: 2,
    explanation: "",
    passage,
  } as LessonStep;
}

function renderReader(mode: "listen_first" | "read_first") {
  const { speak, calls } = controllableSpeak();
  const props = {
    step: readStep(mode),
    speak,
    onAnswer: () => {},
    onReading: () => {},
    disabled: false,
    reveal: null,
  } as unknown as RendererProps<never>;
  render(<ReadPassageRenderer {...(props as Parameters<typeof ReadPassageRenderer>[0])} />);
  return calls;
}

describe("Read it again", () => {
  it("after listening, the story is read again from the first sentence at the same speed", async () => {
    const user = userEvent.setup();
    const calls = renderReader("listen_first");
    await user.click(screen.getByRole("button", { name: "Slow" }));
    await user.click(screen.getByRole("button", { name: /I read it/ }));
    await user.click(screen.getByRole("button", { name: /Read it again/ }));
    expect(calls).toHaveLength(2);
    expect(calls[1].requests[0]).toEqual({ text: "I see a cat.", speed: "slow" });
  });

  it("a child reading by themselves is not read to (nothing starts by itself)", async () => {
    const user = userEvent.setup();
    const calls = renderReader("read_first");
    await user.click(screen.getByRole("button", { name: /I read it/ }));
    await user.click(screen.getByRole("button", { name: /Read it again/ }));
    expect(calls).toHaveLength(0);
  });
});

describe("Try again", () => {
  const steps: SessionStep[] = [{ questionId: "q1", scored: true, maxTries: 3 }];

  it("opens one new try per press: a double press does not skip a try or record anything", () => {
    let state = initialSessionState(steps, { skipIntro: true });
    state = sessionReducer(state, {
      type: "answered",
      isCorrect: false,
      almost: false,
      response: { value: "x" },
    });
    expect(state).toMatchObject({ phase: "retry", attemptNumber: 1 });
    state = sessionReducer(state, { type: "retry" });
    const again = sessionReducer(state, { type: "retry" });
    expect(again).toBe(state);
    expect(state).toMatchObject({ phase: "answering", attemptNumber: 2 });
    // The first try is still the one that counts.
    expect(state.firstTries).toEqual({ q1: false });
  });
});
