import type {
  EditAndCorrectContent,
  EditAnswer,
  GuidedWritingAnswer,
  QuestionResponse,
  SentenceWritingAnswer,
  SentenceWritingContent,
  StoryOrderWritingAnswer,
  TraceAnswer,
  TracingContent,
} from "@/lib/content/question-schemas";
import { DEFAULT_RULES, type WritingRules } from "@/lib/learning/rules";
import { evaluateTrace, type TraceGlyph, type TraceResult, type TraceSettings } from "@/lib/learning/tracing";
import {
  evaluateCompletion,
  evaluateCopy,
  evaluateEdit,
  evaluateRubric,
  evaluateStoryWriting,
  plainMatcher,
  writingLevelRules,
  writtenSentences,
  type CriterionResult,
  type MechanicsSettings,
  type WritingAnalysis,
  type WritingErrorType,
} from "@/lib/learning/writing";

// The writing question types' evaluation (server side, and the device for handwriting,
// whose reference data is public). Typed writing on the device is checked from the
// digest-only answer key instead (answer-key.ts), with the same functions in writing.ts.

export const WRITING_QUESTION_TYPES = new Set([
  "TRACING",
  "SENTENCE_WRITING",
  "GUIDED_WRITING",
  "STORY_ORDER_WRITING",
  "EDIT_AND_CORRECT",
]);

// The level's writing expectations for one question, resolved on the server (and by the
// lesson loader for the device) from rules.writing.
export type WritingSettings = {
  mechanics: MechanicsSettings;
  minSentenceWords: number;
  trace: {
    toleranceScale: number;
    writeToleranceScale: number;
    completionScale: number;
    strokeOrder: "off" | "hint" | "required";
    minPrecision: number;
    almostMargin: number;
  };
};

export function resolveWritingSettings(
  levelCode: string | null,
  rules: WritingRules = DEFAULT_RULES.writing,
): WritingSettings {
  const level = writingLevelRules(levelCode, rules);
  return {
    mechanics: { ...level.mechanics },
    minSentenceWords: level.minSentenceWords,
    trace: {
      toleranceScale: level.traceToleranceScale,
      writeToleranceScale: level.writeToleranceScale,
      completionScale: level.completionScale,
      strokeOrder: level.strokeOrder,
      minPrecision: rules.minPrecision,
      almostMargin: rules.almostMargin,
    },
  };
}

export type WritingContext = {
  content: unknown;
  settings: WritingSettings;
  glyph?: TraceGlyph | null;
  // Known words for spelling and spacing checks in open-ended writing (server only).
  lexicon?: Set<string>;
};

export type WritingEvaluation = {
  isCorrect: boolean;
  almost: boolean;
  errorType: WritingErrorType | TraceErrorType | "invalid_response" | null;
  analysis: WritingAnalysis | null;
};

export type TraceErrorType = "incomplete_trace" | "TRACE_OFF_LETTER" | "TRACE_STROKE_ORDER" | "WRONG_LETTER";

export function traceSettingsFor(
  glyph: TraceGlyph,
  mode: TracingContent["mode"],
  answer: TraceAnswer,
  settings: WritingSettings,
): TraceSettings {
  const writing = mode !== "trace";
  return {
    tolerance:
      glyph.tolerance * (writing ? settings.trace.writeToleranceScale : settings.trace.toleranceScale),
    completion: Math.min(0.95, (answer.completion ?? glyph.completion) * settings.trace.completionScale),
    minPrecision: settings.trace.minPrecision,
    almostMargin: settings.trace.almostMargin,
    align: writing,
    strokeOrder: settings.trace.strokeOrder,
  };
}

// A handwriting answer: the strokes against the glyph, or the typed alternative.
export function evaluateHandwriting(
  glyph: TraceGlyph,
  content: TracingContent,
  answer: TraceAnswer,
  response: { strokes: number[][][]; typed?: string },
  settings: WritingSettings,
): WritingEvaluation {
  if (response.typed !== undefined) {
    const ok = response.typed.trim() === glyph.character;
    const criteria: CriterionResult[] = [
      {
        id: "letter",
        dimension: "letter",
        label: "The right letter",
        hint: `Type ${glyph.name}.`,
        critical: true,
        met: ok,
      },
    ];
    return {
      isCorrect: ok,
      almost: !ok && response.typed.trim().toLowerCase() === glyph.character.toLowerCase(),
      errorType: ok ? null : "WRONG_LETTER",
      analysis: {
        v: 1,
        kind: "trace",
        criteria,
        words: 0,
        sentences: 0,
        trace: { glyph: glyph.code, method: "typed", mode: content.mode },
      },
    };
  }
  const traceSettings = traceSettingsFor(glyph, content.mode, answer, settings);
  const result = evaluateTrace(glyph.strokes, response.strokes, traceSettings);
  return traceVerdict(glyph, content.mode, result, traceSettings);
}

export function traceVerdict(
  glyph: TraceGlyph,
  mode: TracingContent["mode"],
  result: TraceResult,
  settings: TraceSettings,
): WritingEvaluation {
  const criteria: CriterionResult[] = [
    {
      id: "shape",
      dimension: "shape",
      label: "The whole letter",
      hint: result.issues.includes("wrong_shape")
        ? "Look at the letter again: which way does it face?"
        : "Go over every part of the letter.",
      critical: true,
      met: !result.issues.includes("missing_part") && !result.issues.includes("wrong_shape"),
    },
    {
      id: "on-letter",
      dimension: "precision",
      label: "On the lines",
      hint: "Keep your finger on the letter.",
      critical: true,
      met: !result.issues.includes("off_the_letter"),
    },
  ];
  if (settings.strokeOrder !== "off") {
    const required = settings.strokeOrder === "required";
    criteria.push(
      {
        id: "start",
        dimension: "start",
        label: "Start at the dot",
        hint: "Start where the green dot is.",
        critical: required,
        met: result.startOk,
      },
      {
        id: "order",
        dimension: "order",
        label: "Strokes in order",
        hint: "Follow the numbers.",
        critical: required,
        met: result.orderOk,
      },
      {
        id: "direction",
        dimension: "direction",
        label: "The right way",
        hint: "Follow the arrows.",
        critical: required,
        met: result.directionOk,
      },
    );
  }
  const errorType: TraceErrorType | null = result.complete
    ? null
    : result.issues.includes("missing_part")
      ? "incomplete_trace"
      : result.issues.includes("wrong_shape")
        ? "WRONG_LETTER"
        : result.issues.includes("off_the_letter")
          ? "TRACE_OFF_LETTER"
          : "TRACE_STROKE_ORDER";
  return {
    isCorrect: result.complete,
    almost: result.almost,
    errorType,
    analysis: {
      v: 1,
      kind: "trace",
      criteria,
      words: 0,
      sentences: 0,
      trace: {
        glyph: glyph.code,
        method: "draw",
        mode,
        coverage: result.coverage,
        precision: result.precision,
        orderOk: result.orderOk,
        directionOk: result.directionOk,
        startOk: result.startOk,
        strokes: result.strokes.length,
      },
    },
  };
}

const invalid: WritingEvaluation = {
  isCorrect: false,
  almost: false,
  errorType: "invalid_response",
  analysis: null,
};

// Server-side evaluation of a writing question (content and answer from the database).
export function evaluateWritingQuestion(
  questionType: string,
  answer: unknown,
  response: QuestionResponse,
  context: WritingContext,
): WritingEvaluation {
  const { settings } = context;
  const rubricContext = {
    mechanics: settings.mechanics,
    minSentenceWords: settings.minSentenceWords,
    lexicon: context.lexicon,
  };
  switch (questionType) {
    case "TRACING": {
      if (!("strokes" in response) || !context.glyph) return invalid;
      return evaluateHandwriting(
        context.glyph,
        context.content as TracingContent,
        answer as TraceAnswer,
        response,
        settings,
      );
    }
    case "SENTENCE_WRITING": {
      if (!("value" in response)) return invalid;
      const content = context.content as SentenceWritingContent;
      const a = answer as SentenceWritingAnswer;
      if ("rubric" in a) {
        const line = withStarters([response.value], [{ starter: content.starter }])[0];
        return evaluateRubric({
          criteria: a.rubric.criteria,
          lines: [line],
          match: plainMatcher(line),
          firstSentenceMatch: plainMatcher(writtenSentences(line)[0] ?? ""),
          context: rubricContext,
        });
      }
      if (content.mode === "complete")
        return evaluateCompletion({ accepted: a.accepted, actual: response.value });
      return evaluateCopy({ accepted: a.accepted, actual: response.value, mechanics: settings.mechanics });
    }
    case "GUIDED_WRITING": {
      if (!("lines" in response)) return invalid;
      const content = context.content as { frames: { starter?: string }[] };
      const a = answer as GuidedWritingAnswer;
      const lines = withStarters(response.lines, content.frames);
      const whole = lines.join(" ");
      return evaluateRubric({
        criteria: a.rubric.criteria,
        lines,
        match: plainMatcher(whole),
        firstSentenceMatch: plainMatcher(writtenSentences(whole)[0] ?? ""),
        context: rubricContext,
      });
    }
    case "STORY_ORDER_WRITING": {
      if (!("lines" in response) || !response.order) return invalid;
      const a = answer as StoryOrderWritingAnswer;
      return evaluateStoryWriting({
        acceptedOrders: a.acceptedSequences,
        sequence: response.order,
        lines: response.lines,
        eventCriteria: a.eventCriteria,
        criteria: a.rubric.criteria,
        matcherFor: plainMatcher,
        context: rubricContext,
      });
    }
    case "EDIT_AND_CORRECT": {
      if (!("value" in response)) return invalid;
      const content = context.content as EditAndCorrectContent;
      return evaluateEdit({
        original: content.text,
        accepted: (answer as EditAnswer).accepted,
        actual: response.value,
      });
    }
    default:
      return invalid;
  }
}

// A frame's line as the child sees it: the starter followed by what they wrote (a line the
// child left empty stays empty, so it does not count as written).
export function withStarters(lines: string[], frames: { starter?: string }[]): string[] {
  return frames.map((f, i) => {
    const typed = (lines[i] ?? "").trim();
    if (!typed) return "";
    const starter = f.starter?.trim();
    return starter && !typed.toLowerCase().startsWith(starter.toLowerCase()) ? `${starter} ${typed}` : typed;
  });
}
