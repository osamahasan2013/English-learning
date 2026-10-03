"use client";

import Link from "next/link";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { AudioControls } from "@/components/child/audio-controls";
import { notifyQueued } from "@/components/layout/sync-provider";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { ACTIVITY_RENDERERS } from "@/features/activities/registry";
import type { ReadingReport } from "@/features/activities/types";
import { isRenderableQuestionType } from "@/features/activities/supported-types";
import { useAudio } from "@/lib/audio/use-audio";
import type { SpeakFn } from "@/lib/audio/audio-service";
import { visibleWords } from "@/lib/audio/pronunciation";
import type { QuestionResponse } from "@/lib/content/question-schemas";
import { checkWithKey, revealAnswer, type Reveal } from "@/lib/learning/answer-key";
import { pickFeedback, renderFeedback, type FeedbackKind } from "@/lib/learning/feedback";
import type { LessonPayload, LessonStep } from "@/lib/learning/lesson-payload";
import {
  canGoBack,
  currentView,
  firstTryResults,
  initialSessionState,
  isResumable,
  sessionReducer,
  type SessionState,
} from "@/lib/learning/lesson-session";
import type { PrerequisiteCheck } from "@/lib/learning/prerequisites";
import { scoreLesson } from "@/lib/learning/scoring";
import { getLearningDb, type SavedRun } from "@/lib/offline/db";
import { cacheLesson } from "@/lib/offline/lesson-cache";
import { recordEvent } from "@/lib/offline/outbox";
import { currentSessionId } from "@/lib/offline/session-store";
import { cn } from "@/lib/utils";
import { newId } from "@/lib/uuid";
import {
  analyzeStepAnswer,
  HintBox,
  SpellingMistake,
  spellingErrorMessage,
  stepHints,
} from "./spelling-help";

// The reusable lesson player: Intro → Activities → Summary for any lesson, whatever its
// activity types (each step is drawn by the renderer registered for its type).
//
// No progress is lost by accident: every answer goes to the device outbox before
// anything else (src/lib/offline/outbox.ts), and the player's own state is saved on the
// device after every change, so closing the tab or pressing Exit leaves a lesson that
// can be continued where the child left off.

type Achievement = { code: string; title: string; emoji: string };

export function LessonPlayer({
  payload,
  childId,
  readiness = null,
}: {
  payload: LessonPayload;
  childId: string;
  readiness?: PrerequisiteCheck | null;
}) {
  const [run, setRun] = useState<{
    key: number;
    saved: SavedRun | null;
    preview: boolean;
    autoStart: boolean;
  } | null>(null);
  const saveKey = `${childId}:${payload.lesson.id}`;

  // Look for a lesson in progress on this device before showing anything.
  useEffect(() => {
    let active = true;
    getLearningDb()
      .runs.get(saveKey)
      .catch(() => undefined)
      .then((saved) => {
        if (active) setRun({ key: 0, saved: saved ?? null, preview: false, autoStart: false });
      });
    return () => {
      active = false;
    };
  }, [saveKey]);

  if (!run) return <p className="text-muted py-16 text-center text-2xl">Getting ready…</p>;
  return (
    <LessonRun
      key={run.key}
      payload={payload}
      childId={childId}
      readiness={readiness}
      saved={run.saved}
      preview={run.preview}
      autoStart={run.autoStart}
      onRestart={(preview) => {
        void getLearningDb()
          .runs.delete(saveKey)
          .catch(() => {});
        setRun((r) => ({ key: (r?.key ?? 0) + 1, saved: null, preview, autoStart: true }));
      }}
    />
  );
}

function LessonRun({
  payload,
  childId,
  readiness,
  saved,
  preview: startAsPreview,
  autoStart,
  onRestart,
}: {
  payload: LessonPayload;
  childId: string;
  readiness: PrerequisiteCheck | null;
  saved: SavedRun | null;
  preview: boolean;
  autoStart: boolean;
  onRestart: (preview: boolean) => void;
}) {
  const saveKey = `${childId}:${payload.lesson.id}`;
  const assessment = payload.assessment ?? null;
  // Word practice records answers only: no lesson run, so no lesson is "completed" by it.
  const practice = payload.practice ?? null;
  const previewLimit = readiness && !readiness.ready ? readiness.previewSteps : null;
  const allSteps = payload.steps;

  const [preview, setPreview] = useState(saved?.preview ?? startAsPreview);
  const steps = preview && previewLimit ? allSteps.slice(0, previewLimit) : allSteps;
  const sessionSteps = steps.map((s) => ({
    questionId: s.questionId,
    scored: s.scored,
    maxTries: s.maxTries,
  }));
  const resumable = isResumable(saved?.state, sessionSteps) ? saved : null;

  const [state, dispatch] = useReducer(
    (s: SessionState, a: Parameters<typeof sessionReducer>[1] | { type: "load"; state: SessionState }) =>
      a.type === "load" ? a.state : sessionReducer(s, a),
    null,
    () => initialSessionState(sessionSteps, { skipIntro: autoStart }),
  );
  const [runId, setRunId] = useState(() => resumable?.runId ?? newId());
  const [startedAt, setStartedAt] = useState(() => resumable?.startedAt ?? new Date().toISOString());
  const [reveals, setReveals] = useState<Record<string, Reveal | null>>({});
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [confirmExit, setConfirmExit] = useState(false);
  const [checking, setChecking] = useState(false);
  // Spelling hints opened per question (reported with each answer as hintsUsed).
  const [hintsShown, setHintsShown] = useState<Record<string, number>>({});
  const shownAt = useRef(0);
  const runRecorded = useRef(false);
  // The lesson carries its own sound table (phonics sounds, letter names, recorded clips),
  // so its audio also works when the lesson is played offline.
  const { speak: play, supported: audioSupported } = useAudio(payload.sounds);

  // A scored question's own words (its options, items…): a keyword fallback for a sound
  // must not name them ("Which one starts with the sound at the start of egg?").
  const avoid = useRef<string[] | undefined>(undefined);
  const speak: SpeakFn = useCallback(
    (text, speed = "normal", options) => {
      const requests = typeof text === "string" ? [{ text, speed }] : text;
      return play(
        requests.map((r) => ({ ...r, avoid: r.avoid ?? avoid.current })),
        options,
      );
    },
    [play],
  );
  const step: LessonStep | undefined = steps[state.index];
  // Declared before the effect that reads the prompt aloud, so it is current by then.
  useEffect(() => {
    avoid.current = step?.scored ? [...visibleWords(step.question.content)] : undefined;
  }, [step]);
  const view = currentView(state);
  const sessionId = () => currentSessionId(childId, payload.rules.player.sessionTimeoutMinutes);

  useEffect(() => {
    if (!payload.practice) cacheLesson(payload).catch(() => {});
  }, [payload]);

  useEffect(() => {
    const onAchievements = (e: Event) =>
      setAchievements((a) => [...a, ...((e as CustomEvent<Achievement[]>).detail ?? [])]);
    window.addEventListener("learning:achievements", onAchievements);
    return () => window.removeEventListener("learning:achievements", onAchievements);
  }, []);

  // Save the player's place after every change (never the summary: that run is done).
  useEffect(() => {
    const runs = getLearningDb().runs;
    if (state.screen === "summary") {
      void runs.delete(saveKey).catch(() => {});
      return;
    }
    if (state.screen === "intro") return;
    void runs.put({ key: saveKey, runId, startedAt, preview, state, updatedAt: Date.now() }).catch(() => {});
  }, [state, saveKey, runId, startedAt, preview]);

  // A new step or a retry: restart the response timer and read the prompt aloud.
  useEffect(() => {
    if (state.screen !== "steps" || !step || view.reviewing) return;
    shownAt.current = performance.now();
    const text =
      step.question.type === "INTRO"
        ? step.question.content.speech || step.question.content.body
        : step.promptSpeech || step.instructionsSpeech;
    if (text) void speak(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the step or try changes
  }, [state.screen, state.index, state.attemptNumber, speak]);

  // Recover the answer to show for a revealed step (live or revisited).
  useEffect(() => {
    if (!step || view.phase !== "reveal" || step.questionId in reveals) return;
    let active = true;
    void revealAnswer(step.question, step.answerKey).then((r) => {
      if (active) setReveals((all) => ({ ...all, [step.questionId]: r }));
    });
    return () => {
      active = false;
    };
  }, [step, view.phase, reveals]);

  // Lesson finished: record the run once (the server scores it from the answers). A
  // preview is not a completed lesson, so it records answers but no run. An assessment
  // records its sitting instead, which the server scores per area.
  useEffect(() => {
    if (state.screen !== "summary" || runRecorded.current || preview || practice) return;
    runRecorded.current = true;
    const completedAt = new Date().toISOString();
    void recordEvent(
      childId,
      assessment
        ? {
            kind: "assessment_run",
            id: runId,
            assessmentId: assessment.id,
            sessionId: sessionId(),
            startedAt,
            completedAt,
          }
        : {
            kind: "lesson_run",
            id: runId,
            lessonId: payload.lesson.id,
            sessionId: sessionId(),
            startedAt,
            completedAt,
          },
    ).then(() => notifyQueued());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per finished run
  }, [state.screen]);

  async function handleAnswer(response: QuestionResponse) {
    if (!step || view.reviewing || state.phase !== "answering" || !step.scored || checking) return;
    setChecking(true);
    const attemptNumber = state.attemptNumber;
    const responseTimeMs = Math.min(3_600_000, Math.round(performance.now() - shownAt.current));
    // Saved first: the answer is on the device before any feedback is shown.
    void recordEvent(childId, {
      kind: "attempt",
      id: newId(),
      questionId: step.questionId,
      lessonRunId: assessment || practice ? null : runId,
      assessmentId: assessment?.id ?? null,
      assessmentAttemptId: assessment ? runId : null,
      sessionId: sessionId(),
      attemptNumber,
      response,
      responseTimeMs,
      hintsUsed: hintsShown[step.questionId] ?? 0,
      attemptedAt: new Date().toISOString(),
    }).then(() => notifyQueued());
    const result = await checkWithKey(step.question.type, step.answerKey, response);
    setChecking(false);
    dispatch({ type: "answered", isCorrect: result.isCorrect, almost: result.almost, response });

    const kind: FeedbackKind = result.isCorrect
      ? "CORRECT"
      : attemptNumber < step.maxTries
        ? result.almost
          ? "ALMOST_CORRECT"
          : "TRY_AGAIN"
        : "INCORRECT";
    let answer: string | undefined;
    if (kind === "INCORRECT") {
      const reveal = await revealAnswer(step.question, step.answerKey);
      setReveals((all) => ({ ...all, [step.questionId]: reveal }));
      answer = reveal?.text || undefined;
    }
    const message = renderFeedback(
      pickFeedback(payload.feedback, kind, state.index + attemptNumber, { hasAnswer: !!answer }),
      { answer },
    );
    // A spelling mistake is also named ("Two letters make that sound!").
    const mistake = result.isCorrect
      ? null
      : spellingErrorMessage(
          analyzeStepAnswer(step, response),
          payload.feedback,
          state.index + attemptNumber,
        );
    void speak(mistake ? `${message.speech} ${mistake.speech}` : message.speech);
  }

  // A story was read (READ_PASSAGE): recorded once, like an answer, never scored. A text
  // revisited after moving on counts as a re-read.
  function handleReading(report: ReadingReport) {
    if (!step) return;
    void recordEvent(childId, {
      kind: "reading",
      id: newId(),
      storyId: report.storyId,
      lessonId: assessment || practice ? null : payload.lesson.id,
      lessonRunId: assessment || practice ? null : runId,
      questionId: step.questionId,
      sessionId: sessionId(),
      mode: view.reviewing ? "reread" : report.mode,
      startedAt: report.startedAt,
      durationMs: report.durationMs,
      listens: report.listens,
      slowListens: report.slowListens,
      rereads: report.rereads,
      helpWordIds: report.helpWordIds,
      selfCheck: report.selfCheck,
    }).then(() => notifyQueued());
  }

  if (state.screen === "intro") {
    return (
      <LessonIntro
        payload={payload}
        readiness={readiness}
        resumable={resumable}
        stepCount={steps.length}
        speak={speak}
        onStart={(asPreview) => {
          if (asPreview !== preview) {
            onRestart(asPreview);
            return;
          }
          setRunId(newId());
          setStartedAt(new Date().toISOString());
          dispatch({ type: "start" });
        }}
        onResume={() => {
          if (!resumable) return;
          setPreview(resumable.preview);
          dispatch({ type: "load", state: resumable.state });
        }}
      />
    );
  }

  if (state.screen === "summary") {
    return (
      <LessonSummary
        payload={payload}
        score={scoreLesson(firstTryResults(state), payload.rules.scoring)}
        startedAt={startedAt}
        achievements={achievements}
        preview={preview}
        practice={practice}
        recommendation={readiness?.recommendation ?? null}
        onPlayAgain={() => onRestart(false)}
        speak={speak}
      />
    );
  }

  if (!step) return null;
  const Renderer = isRenderableQuestionType(step.question.type)
    ? ACTIVITY_RENDERERS[step.question.type]
    : null;
  const newActivity = state.index === 0 || steps[state.index - 1].activityId !== step.activityId;
  const reveal = reveals[step.questionId] ?? null;

  return (
    <div className="flex min-h-[70dvh] flex-col gap-6">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => setConfirmExit(true)}
          aria-label="Stop the lesson"
          className="bg-surface flex size-12 shrink-0 items-center justify-center rounded-full text-2xl font-bold shadow-sm"
        >
          <span aria-hidden>✕</span>
        </button>
        <ProgressBar
          value={state.furthest}
          max={steps.length}
          label={`Step ${state.index + 1} of ${steps.length}`}
          className="h-5"
          tone="success"
        />
        <span className="text-muted shrink-0 text-lg font-bold" aria-hidden>
          {state.index + 1}/{steps.length}
        </span>
      </div>

      {!audioSupported ? (
        <p role="note" className="bg-surface-muted rounded-2xl px-4 py-2 text-center text-lg font-semibold">
          <span aria-hidden>🔇 </span>No sound on this device. Read the words, or ask a grown-up to read them.
        </p>
      ) : null}
      {preview ? (
        <p className="bg-accent-soft text-accent rounded-2xl px-4 py-2 text-center text-lg font-bold">
          <span aria-hidden>👀 </span>Sneak peek
        </p>
      ) : null}
      {view.reviewing ? (
        <p className="bg-surface-muted rounded-2xl px-4 py-2 text-center text-lg font-semibold">
          <span aria-hidden>⏪ </span>Looking back. Your answer is saved.
        </p>
      ) : null}
      {newActivity && step.instructions && step.question.type !== "INTRO" ? (
        <p className="text-muted text-center text-xl font-semibold">{step.instructions}</p>
      ) : null}

      <section
        aria-live="polite"
        className="flex-1"
        key={`${step.questionId}-${view.attemptNumber}-${view.reviewing ? "review" : "live"}`}
        data-question-id={step.questionId}
      >
        {Renderer ? (
          <Renderer
            step={step}
            phase={view.phase}
            lastResponse={view.response}
            reveal={reveal}
            onAnswer={(r) => void handleAnswer(r)}
            speak={speak}
            onReading={handleReading}
          />
        ) : (
          <p className="text-center text-2xl">Let&apos;s skip this one.</p>
        )}
      </section>

      {step.scored && view.phase === "answering" && !view.reviewing && stepHints(step).length > 0 ? (
        <HintBox
          key={step.questionId}
          step={step}
          shown={hintsShown[step.questionId] ?? 0}
          onShow={(count) => setHintsShown((all) => ({ ...all, [step.questionId]: count }))}
          speak={speak}
        />
      ) : null}

      <FeedbackBar
        step={step}
        payload={payload}
        seed={state.index + view.attemptNumber}
        phase={view.phase}
        feedback={view.feedback}
        response={view.response}
        reveal={reveal}
        reviewing={view.reviewing}
        canGoBack={canGoBack(state)}
        onPrevious={() => dispatch({ type: "previous" })}
        onNext={() => dispatch({ type: "next" })}
        onRetry={() => dispatch({ type: "retry" })}
        speak={speak}
      />

      {confirmExit ? <ExitDialog onStay={() => setConfirmExit(false)} /> : null}
    </div>
  );
}

function LessonIntro({
  payload,
  readiness,
  resumable,
  stepCount,
  speak,
  onStart,
  onResume,
}: {
  payload: LessonPayload;
  readiness: PrerequisiteCheck | null;
  resumable: SavedRun | null;
  stepCount: number;
  speak: SpeakFn;
  onStart: (preview: boolean) => void;
  onResume: () => void;
}) {
  const { lesson } = payload;
  const intro = lesson.introSpeech || `${lesson.childTitle}. ${lesson.description}`.trim();
  const stretch = readiness !== null && !readiness.ready;

  useEffect(() => {
    void speak(intro);
  }, [intro, speak]);

  return (
    <div className="animate-pop flex flex-col items-center gap-6 py-6 text-center">
      <Link
        href="/child/home"
        aria-label="Go home"
        className="bg-surface flex size-12 items-center justify-center self-start rounded-full text-2xl font-bold shadow-sm"
      >
        <span aria-hidden>🏠</span>
      </Link>
      <p className="text-8xl" aria-hidden>
        {lesson.emoji || "📘"}
      </p>
      <h1 className="text-4xl font-extrabold">{lesson.childTitle}</h1>
      {lesson.description ? <p className="max-w-xl text-2xl">{lesson.description}</p> : null}
      <p className="text-muted text-lg font-semibold">
        {[lesson.subjectName, lesson.levelName, `about ${lesson.estimatedMinutes} min`]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <AudioControls text={intro} speak={speak} className="justify-center" />

      {stretch ? (
        <div role="note" className="bg-accent-soft text-accent max-w-xl space-y-3 rounded-3xl p-5">
          <p className="text-2xl font-extrabold">
            <span aria-hidden>🧗 </span>This one is a stretch!
          </p>
          {readiness.recommendation ? (
            <p className="text-xl">Practise {readiness.recommendation.title} first, or take a sneak peek.</p>
          ) : (
            <p className="text-xl">Take a sneak peek, then come back after more practice.</p>
          )}
          <div className="flex flex-wrap justify-center gap-3">
            {readiness.recommendation ? (
              <Link
                href={`/child/learn/${readiness.recommendation.lessonId}`}
                className="bg-success inline-flex min-h-16 items-center gap-2 rounded-3xl px-6 text-xl font-bold text-white"
              >
                <span aria-hidden>💪</span> Practise {readiness.recommendation.title}
              </Link>
            ) : null}
            <Button size="lg" variant="secondary" onClick={() => onStart(true)}>
              <span aria-hidden>👀</span> Sneak peek
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap justify-center gap-3">
        {resumable ? (
          <>
            <Button size="xl" onClick={onResume}>
              <span aria-hidden>▶</span> Keep going
            </Button>
            <Button size="xl" variant="secondary" onClick={() => onStart(false)}>
              <span aria-hidden>🔁</span> Start again
            </Button>
          </>
        ) : (
          <Button size="xl" variant={stretch ? "secondary" : "primary"} onClick={() => onStart(false)}>
            <span aria-hidden>▶</span> {stretch ? "Try the whole lesson" : "Start"}
          </Button>
        )}
      </div>
      <p className="text-muted" aria-hidden>
        {stepCount} steps
      </p>
    </div>
  );
}

function FeedbackBar({
  step,
  payload,
  seed,
  phase,
  feedback,
  response,
  reveal,
  reviewing,
  canGoBack: back,
  onPrevious,
  onNext,
  onRetry,
  speak,
}: {
  step: LessonStep;
  payload: LessonPayload;
  seed: number;
  phase: string;
  feedback: FeedbackKind | null;
  response: QuestionResponse | null;
  reveal: Reveal | null;
  reviewing: boolean;
  canGoBack: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onRetry: () => void;
  speak: SpeakFn;
}) {
  const previous = back ? (
    <Button variant="secondary" size="lg" onClick={onPrevious}>
      <span aria-hidden>⬅</span> Back
    </Button>
  ) : null;

  if (!step.scored || (phase === "answering" && !feedback)) {
    // Only a bar with "Next" stays pinned; while answering, Back must not cover the
    // answer area (the child keyboard's Delete and Check keys on a phone).
    const pinned = !step.scored || reviewing;
    return (
      <div className={cn("flex justify-center gap-3", pinned && "sticky bottom-4")}>
        {previous}
        {!step.scored || reviewing ? (
          <Button size="xl" onClick={onNext}>
            Next <span aria-hidden>➜</span>
          </Button>
        ) : null}
      </div>
    );
  }

  const kind = feedback ?? (phase === "correct" ? "CORRECT" : "INCORRECT");
  const answer = reveal?.text || undefined;
  const message = renderFeedback(pickFeedback(payload.feedback, kind, seed, { hasAnswer: !!answer }), {
    answer,
  });
  const box =
    kind === "CORRECT"
      ? "bg-success text-white"
      : kind === "TRY_AGAIN" || kind === "ALMOST_CORRECT"
        ? "bg-warning-soft text-warning"
        : "bg-accent-soft text-accent";
  const showExplanation = step.explanation && (kind === "CORRECT" || kind === "INCORRECT");
  // Spelling: name the mistake and show the child's letters (the right word only once the
  // answer is revealed).
  const analysis =
    kind !== "CORRECT" && (phase === "retry" || phase === "reveal")
      ? analyzeStepAnswer(step, response)
      : null;
  const mistake = analysis && !analysis.correct ? analysis : null;

  return (
    <div
      role="status"
      className={cn("animate-pop sticky bottom-4 flex flex-col gap-3 rounded-[2rem] p-5 shadow-lg", box)}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="flex items-center gap-3 text-3xl font-extrabold">
          <span className="flex size-12 items-center justify-center rounded-full bg-white/30" aria-hidden>
            {message.emoji}
          </span>
          {message.text}
        </p>
        <div className="flex flex-wrap gap-2">
          {previous}
          {kind === "INCORRECT" && answer ? (
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
              variant={kind === "CORRECT" ? "secondary" : "primary"}
              onClick={onNext}
              autoFocus
            >
              Next <span aria-hidden>➜</span>
            </Button>
          )}
        </div>
      </div>
      {mistake ? (
        <div className="bg-surface text-foreground rounded-3xl p-4">
          <SpellingMistake
            step={step}
            analysis={mistake}
            message={spellingErrorMessage(mistake, payload.feedback, seed)}
            revealed={phase === "reveal"}
          />
        </div>
      ) : null}
      {showExplanation ? <p className="text-xl font-semibold">{step.explanation}</p> : null}
    </div>
  );
}

function ExitDialog({ onStay }: { onStay: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="exit-title"
        className="bg-surface animate-pop w-full max-w-md space-y-5 rounded-[2rem] p-6 text-center shadow-xl"
      >
        <p className="text-6xl" aria-hidden>
          ✋
        </p>
        <h2 id="exit-title" className="text-3xl font-extrabold">
          Stop for now?
        </h2>
        <p className="text-xl">Your answers are saved. You can keep going later.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button size="lg" onClick={onStay} autoFocus>
            <span aria-hidden>▶</span> Keep going
          </Button>
          <Link
            href="/child/home"
            className="bg-surface-muted inline-flex min-h-16 items-center gap-2 rounded-3xl px-6 text-xl font-bold"
          >
            <span aria-hidden>🏠</span> Stop
          </Link>
        </div>
      </div>
    </div>
  );
}

function LessonSummary({
  payload,
  score,
  startedAt,
  achievements,
  preview,
  practice,
  recommendation,
  onPlayAgain,
  speak,
}: {
  payload: LessonPayload;
  score: ReturnType<typeof scoreLesson>;
  startedAt: string;
  achievements: Achievement[];
  preview: boolean;
  practice: LessonPayload["practice"] | null;
  recommendation: { lessonId: string; title: string } | null;
  onPlayAgain: () => void;
  speak: SpeakFn;
}) {
  const completed = renderFeedback(pickFeedback(payload.feedback, "COMPLETED", score.stars));
  const [minutes] = useState(() => Math.max(1, Math.round((Date.now() - Date.parse(startedAt)) / 60000)));
  useEffect(() => {
    void speak(completed.speech);
  }, [completed.speech, speak]);

  return (
    <div className="animate-pop flex flex-col items-center gap-6 py-8 text-center">
      <p className="text-8xl" aria-hidden>
        {preview ? "👀" : score.stars === 3 ? "🏆" : completed.emoji || "🎉"}
      </p>
      <h1 className="text-4xl font-extrabold">
        {preview ? "Nice peek!" : practice ? "Great practice!" : `You finished ${payload.lesson.childTitle}!`}
      </h1>
      <p className="text-2xl font-bold">{completed.text}</p>
      {!preview && !practice ? (
        <p className="text-6xl" aria-label={`${score.stars} out of 3 stars`}>
          {"⭐".repeat(score.stars)}
          <span className="opacity-25">{"⭐".repeat(3 - score.stars)}</span>
        </p>
      ) : null}
      <p className="text-2xl font-semibold">
        You got {score.correct} of {score.total} right the first time.
      </p>
      <p className="text-muted text-lg">
        {Math.round(score.percent)}% · {minutes} min
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
        {preview && recommendation ? (
          <Link
            href={`/child/learn/${recommendation.lessonId}`}
            className="bg-success inline-flex min-h-20 items-center gap-2 rounded-3xl px-8 text-2xl font-semibold text-white"
          >
            <span aria-hidden>💪</span> Practise {recommendation.title}
          </Link>
        ) : null}
        {practice ? (
          <Link
            href={practice.returnHref}
            className="bg-accent inline-flex min-h-20 items-center gap-2 rounded-3xl px-8 text-2xl font-semibold text-white"
          >
            <span aria-hidden>
              {practice.kind === "word" ? "🔙" : practice.kind === "my_words" ? "📚" : "✏️"}
            </span>{" "}
            {practice.returnLabel ?? (practice.kind === "word" ? "Back to the word" : "My Words")}
          </Link>
        ) : null}
        <Button size="xl" variant="secondary" onClick={onPlayAgain}>
          <span aria-hidden>🔁</span>{" "}
          {preview ? "Play the whole lesson" : practice ? "Practice again" : "Play again"}
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
