"use client";

import Link from "next/link";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { notifyQueued } from "@/components/layout/sync-provider";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { ACTIVITY_RENDERERS } from "@/features/activities/registry";
import { isRenderableQuestionType } from "@/features/activities/supported-types";
import { useAudio } from "@/lib/audio/use-audio";
import type { AudioSpeed } from "@/lib/audio/audio-service";
import type { QuestionResponse } from "@/lib/content/question-schemas";
import { answerText } from "@/lib/learning/answer-text";
import { evaluateResponse } from "@/lib/learning/evaluate";
import type { LessonPayload } from "@/lib/learning/lesson-payload";
import { firstTryResults, initialSessionState, sessionReducer } from "@/lib/learning/lesson-session";
import { scoreLesson } from "@/lib/learning/scoring";
import { cacheLesson } from "@/lib/offline/lesson-cache";
import { recordEvent } from "@/lib/offline/outbox";
import { cn } from "@/lib/utils";
import { newId } from "@/lib/uuid";

const PRAISE = ["Great job!", "Well done!", "You got it!", "Super!", "Brilliant!"];

type Achievement = { code: string; title: string; emoji: string };

export function LessonPlayer({ payload, childId }: { payload: LessonPayload; childId: string }) {
  const [runKey, setRunKey] = useState(0);
  return (
    <LessonRun key={runKey} payload={payload} childId={childId} onPlayAgain={() => setRunKey((k) => k + 1)} />
  );
}

function LessonRun({
  payload,
  childId,
  onPlayAgain,
}: {
  payload: LessonPayload;
  childId: string;
  onPlayAgain: () => void;
}) {
  const [state, dispatch] = useReducer(sessionReducer, payload.steps, (steps) =>
    initialSessionState(steps.map((s) => ({ questionId: s.questionId, scored: s.scored }))),
  );
  const [runId] = useState(newId);
  const [startedAt] = useState(() => new Date().toISOString());
  const [lastResponse, setLastResponse] = useState<QuestionResponse | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const shownAt = useRef(0);
  const runRecorded = useRef(false);
  const { speak: play } = useAudio();

  const speak = useCallback((text: string, speed: AudioSpeed = "normal") => play({ text, speed }), [play]);
  const step = payload.steps[state.index];

  useEffect(() => {
    cacheLesson(payload).catch(() => {});
  }, [payload]);

  useEffect(() => {
    const onAchievements = (e: Event) =>
      setAchievements((a) => [...a, ...((e as CustomEvent<Achievement[]>).detail ?? [])]);
    window.addEventListener("learning:achievements", onAchievements);
    return () => window.removeEventListener("learning:achievements", onAchievements);
  }, []);

  // A new step or a retry: restart the response timer and read the prompt aloud.
  useEffect(() => {
    if (state.finished) return;
    shownAt.current = performance.now();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clears the previous step's response when the step changes
    setLastResponse(null);
    const current = payload.steps[state.index];
    const text =
      current.question.type === "INTRO"
        ? current.question.content.speech || current.question.content.body
        : current.promptSpeech || current.instructionsSpeech;
    if (text) void speak(text);
  }, [state.index, state.attemptNumber, state.finished, payload.steps, speak]);

  // Lesson finished: record the run once (the server scores it from the answers).
  useEffect(() => {
    if (!state.finished || runRecorded.current) return;
    runRecorded.current = true;
    void recordEvent(childId, {
      kind: "lesson_run",
      id: runId,
      lessonId: payload.lesson.id,
      startedAt,
      completedAt: new Date().toISOString(),
    }).then(() => notifyQueued());
  }, [state.finished, childId, runId, payload.lesson.id, startedAt]);

  function handleAnswer(response: QuestionResponse) {
    if (state.phase !== "answering" || !step.scored) return;
    const result = evaluateResponse(step.question.type, step.question.answer, response);
    setLastResponse(response);
    dispatch({ type: "answered", isCorrect: result.isCorrect });
    void recordEvent(childId, {
      kind: "attempt",
      id: newId(),
      questionId: step.questionId,
      lessonRunId: runId,
      attemptNumber: state.attemptNumber,
      response,
      responseTimeMs: Math.min(3_600_000, Math.round(performance.now() - shownAt.current)),
      attemptedAt: new Date().toISOString(),
    }).then(() => notifyQueued());

    if (result.isCorrect) void speak(PRAISE[state.index % PRAISE.length]);
    else if (state.attemptNumber < 2) void speak("Almost! Try again.");
    else void speak(`The answer is ${answerText(step.question)}.`);
  }

  if (state.finished) {
    const score = scoreLesson(firstTryResults(state));
    return (
      <LessonSummary
        payload={payload}
        score={score}
        achievements={achievements}
        onPlayAgain={onPlayAgain}
        speak={speak}
      />
    );
  }

  const Renderer = isRenderableQuestionType(step.question.type)
    ? ACTIVITY_RENDERERS[step.question.type]
    : null;
  const newActivity = state.index === 0 || payload.steps[state.index - 1].activityId !== step.activityId;

  return (
    <div className="flex min-h-[70dvh] flex-col gap-6">
      <div className="flex items-center gap-4">
        <Link
          href="/child/home"
          aria-label="Stop the lesson and go home"
          className="bg-surface flex size-12 shrink-0 items-center justify-center rounded-full text-2xl font-bold shadow-sm"
        >
          <span aria-hidden>✕</span>
        </Link>
        <ProgressBar
          value={state.index}
          max={payload.steps.length}
          label="Lesson progress"
          className="h-5"
          tone="success"
        />
        <span className="text-3xl" aria-hidden>
          {payload.lesson.emoji}
        </span>
      </div>

      {newActivity && step.instructions && step.question.type !== "INTRO" ? (
        <p className="text-muted text-center text-xl font-semibold">{step.instructions}</p>
      ) : null}

      <section
        aria-live="polite"
        className="flex-1"
        key={`${step.questionId}-${state.attemptNumber}`}
        data-question-id={step.questionId}
      >
        {Renderer ? (
          <Renderer
            step={step}
            phase={state.phase}
            lastResponse={lastResponse}
            onAnswer={handleAnswer}
            speak={speak}
          />
        ) : (
          <p className="text-center text-2xl">Let&apos;s skip this one.</p>
        )}
      </section>

      <FeedbackBar
        scored={step.scored}
        phase={state.phase}
        praise={PRAISE[state.index % PRAISE.length]}
        answer={step.scored ? answerText(step.question) : ""}
        onNext={() => dispatch({ type: "next" })}
        onRetry={() => dispatch({ type: "retry" })}
        speak={speak}
      />
    </div>
  );
}

function FeedbackBar({
  scored,
  phase,
  praise,
  answer,
  onNext,
  onRetry,
  speak,
}: {
  scored: boolean;
  phase: string;
  praise: string;
  answer: string;
  onNext: () => void;
  onRetry: () => void;
  speak: (text: string) => Promise<unknown>;
}) {
  if (!scored) {
    return (
      <div className="sticky bottom-4 flex justify-center">
        <Button size="xl" onClick={onNext}>
          Next <span aria-hidden>➜</span>
        </Button>
      </div>
    );
  }
  if (phase === "answering") return null;

  const tone =
    phase === "correct"
      ? { box: "bg-success text-white", icon: "✓", text: praise }
      : phase === "retry"
        ? { box: "bg-warning-soft text-warning", icon: "↻", text: "Almost! Try again." }
        : { box: "bg-accent-soft text-accent", icon: "💡", text: `The answer is: ${answer}` };

  return (
    <div
      role="status"
      className={cn(
        "animate-pop sticky bottom-4 flex flex-wrap items-center justify-between gap-4 rounded-[2rem] p-5 shadow-lg",
        tone.box,
      )}
    >
      <p className="flex items-center gap-3 text-3xl font-extrabold">
        <span className="flex size-12 items-center justify-center rounded-full bg-white/30" aria-hidden>
          {tone.icon}
        </span>
        {tone.text}
      </p>
      <div className="flex gap-2">
        {phase === "reveal" ? (
          <Button variant="secondary" size="lg" onClick={() => void speak(answer)}>
            <span aria-hidden>🔊</span> Listen
          </Button>
        ) : null}
        {phase === "retry" ? (
          <Button size="xl" onClick={onRetry}>
            Try again
          </Button>
        ) : (
          <Button
            size="xl"
            variant={phase === "correct" ? "secondary" : "primary"}
            onClick={onNext}
            autoFocus
          >
            Next <span aria-hidden>➜</span>
          </Button>
        )}
      </div>
    </div>
  );
}

function LessonSummary({
  payload,
  score,
  achievements,
  onPlayAgain,
  speak,
}: {
  payload: LessonPayload;
  score: ReturnType<typeof scoreLesson>;
  achievements: Achievement[];
  onPlayAgain: () => void;
  speak: (text: string) => Promise<unknown>;
}) {
  useEffect(() => {
    void speak(
      score.stars === 3
        ? "Amazing! Three stars!"
        : score.stars === 2
          ? "Great work! Two stars!"
          : "Good try! You finished!",
    );
  }, [score.stars, speak]);

  return (
    <div className="animate-pop flex flex-col items-center gap-6 py-8 text-center">
      <p className="text-8xl" aria-hidden>
        {score.stars === 3 ? "🏆" : "🎉"}
      </p>
      <h1 className="text-4xl font-extrabold">You finished {payload.lesson.childTitle}!</h1>
      <p className="text-6xl" aria-label={`${score.stars} out of 3 stars`}>
        {"⭐".repeat(score.stars)}
        <span className="opacity-25">{"⭐".repeat(3 - score.stars)}</span>
      </p>
      <p className="text-2xl font-semibold">
        You got {score.correct} of {score.total} right the first time.
      </p>
      {achievements.length > 0 ? (
        <div role="status" className="bg-accent-soft text-accent rounded-3xl p-5">
          <p className="text-xl font-bold">New badge!</p>
          {achievements.map((a) => (
            <p key={a.code} className="text-3xl font-extrabold">
              <span aria-hidden>{a.emoji} </span>
              {a.title}
            </p>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap justify-center gap-3">
        <Button size="xl" variant="secondary" onClick={onPlayAgain}>
          <span aria-hidden>🔁</span> Play again
        </Button>
        <Link
          href="/child/home"
          className="bg-success inline-flex min-h-20 items-center gap-2 rounded-3xl px-8 text-2xl font-semibold text-white"
        >
          <span aria-hidden>🏠</span> Home
        </Link>
      </div>
    </div>
  );
}
