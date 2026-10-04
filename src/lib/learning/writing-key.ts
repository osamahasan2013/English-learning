import type {
  EditAnswer,
  GuidedWritingAnswer,
  QuestionResponse,
  SentenceWritingAnswer,
  StoryOrderWritingAnswer,
  TraceAnswer,
  TracingContent,
} from "@/lib/content/question-schemas";
import { canonicalSentence } from "@/lib/learning/spelling";
import { evaluateTrace, type TraceGlyph, type TraceSettings } from "@/lib/learning/tracing";
import {
  canonicalCompletion,
  canonicalEdit,
  canonicalPhrase,
  compactWords,
  copyVerdict,
  evaluateRubric,
  evaluateStoryWriting,
  phrasesOf,
  writtenSentences,
  writtenWords,
  type MechanicsSettings,
  type PhraseMatcher,
  type RubricCriterion,
  type WritingAnalysis,
} from "@/lib/learning/writing";
import {
  traceSettingsFor,
  traceVerdict,
  withStarters,
  type WritingSettings,
} from "@/lib/learning/writing-evaluation";

// Answer keys for the writing question types (see answer-key.ts, ADR-021). The device gets
// salted digests of the accepted sentences and of each required keyword, never the words,
// and runs the same checks as the server (writing.ts) with digests compared instead of
// text. Handwriting needs no secret: its key carries the glyph and the tracing settings.

type Digest = (value: string) => Promise<string>;

type Settings = { mechanics: MechanicsSettings; minSentenceWords: number };

export type WritingKey =
  | { mode: "trace"; glyph: TraceGlyph; traceMode: TracingContent["mode"]; settings: TraceSettings }
  | {
      mode: "copy";
      salt: string;
      digests: string[];
      compact: string[];
      words: string[];
      mechanics: MechanicsSettings;
    }
  | { mode: "complete"; salt: string; digests: string[] }
  // `original`: the sentence to correct, as shown (no secret): an unchanged answer is no near miss.
  | { mode: "edit"; salt: string; digests: string[]; words: string[]; original: string }
  | {
      mode: "rubric";
      salt: string;
      criteria: RubricCriterion[];
      starters: (string | undefined)[];
      settings: Settings;
    }
  | {
      mode: "story";
      salt: string;
      orders: string[];
      eventCriteria: Record<string, RubricCriterion[]>;
      criteria: RubricCriterion[];
      settings: Settings;
    };

export const WRITING_KEY_MODES = new Set(["trace", "copy", "complete", "edit", "rubric", "story"]);

const keywordForm = (value: string) => `kw:${canonicalPhrase(value)}`;
const orderForm = (ids: string[]) => `order:${ids.map((i) => i.trim().toLowerCase()).join("|")}`;

async function digestCriteria(criteria: RubricCriterion[], hash: Digest): Promise<RubricCriterion[]> {
  return Promise.all(
    criteria.map(async (c) =>
      c.dimension === "keywords" || c.dimension === "topic_sentence"
        ? {
            ...c,
            groups: await Promise.all(c.groups.map((g) => Promise.all(g.map((a) => hash(keywordForm(a)))))),
          }
        : c,
    ),
  );
}

export async function buildWritingKey(args: {
  questionType: string;
  answer: unknown;
  content: unknown;
  salt: string;
  hash: Digest;
  glyph?: TraceGlyph | null;
  settings: WritingSettings;
}): Promise<WritingKey | null> {
  const { questionType, salt, hash, settings } = args;
  const unique = async (values: string[]) => Promise.all([...new Set(values)].map((v) => hash(v)));
  const text = { mechanics: settings.mechanics, minSentenceWords: settings.minSentenceWords };
  switch (questionType) {
    case "TRACING": {
      if (!args.glyph) return null;
      const content = args.content as TracingContent;
      return {
        mode: "trace",
        glyph: args.glyph,
        traceMode: content.mode,
        settings: traceSettingsFor(args.glyph, content.mode, args.answer as TraceAnswer, settings),
      };
    }
    case "SENTENCE_WRITING": {
      const answer = args.answer as SentenceWritingAnswer;
      const content = args.content as { mode: string; model?: string; starter?: string };
      if ("rubric" in answer)
        return {
          mode: "rubric",
          salt,
          criteria: await digestCriteria(answer.rubric.criteria, hash),
          starters: [content.starter],
          settings: text,
        };
      if (content.mode === "complete")
        return { mode: "complete", salt, digests: await unique(answer.accepted.map(canonicalCompletion)) };
      return {
        mode: "copy",
        salt,
        digests: await unique(answer.accepted.map(canonicalSentence)),
        compact: await unique(answer.accepted.map((a) => `~${compactWords(a)}`)),
        // The model sentence is on screen, so its words are no secret.
        words: [...new Set(writtenWords(content.model ?? ""))],
        mechanics: settings.mechanics,
      };
    }
    case "GUIDED_WRITING": {
      const answer = args.answer as GuidedWritingAnswer;
      const content = args.content as { frames: { starter?: string }[] };
      return {
        mode: "rubric",
        salt,
        criteria: await digestCriteria(answer.rubric.criteria, hash),
        starters: content.frames.map((f) => f.starter),
        settings: text,
      };
    }
    case "STORY_ORDER_WRITING": {
      const answer = args.answer as StoryOrderWritingAnswer;
      const eventCriteria: Record<string, RubricCriterion[]> = {};
      for (const [id, criteria] of Object.entries(answer.eventCriteria))
        eventCriteria[id] = await digestCriteria(criteria, hash);
      return {
        mode: "story",
        salt,
        orders: await unique(answer.acceptedSequences.map(orderForm)),
        eventCriteria,
        criteria: await digestCriteria(answer.rubric.criteria, hash),
        settings: text,
      };
    }
    case "EDIT_AND_CORRECT": {
      const answer = args.answer as EditAnswer;
      return {
        mode: "edit",
        salt,
        original: canonicalEdit((args.content as { text: string }).text),
        digests: await unique(answer.accepted.map(canonicalEdit)),
        // "Words right, marks not yet": a near miss.
        words: await unique(answer.accepted.map((a) => `~${canonicalSentence(a)}`)),
      };
    }
    default:
      return null;
  }
}

export type WritingKeyCheck = { isCorrect: boolean; almost: boolean; writing: WritingAnalysis | null };

async function digestMatcher(text: string, hash: Digest): Promise<PhraseMatcher> {
  const digests = new Set(await Promise.all(phrasesOf(text).map((p) => hash(keywordForm(p)))));
  return (alternatives) => alternatives.some((d) => digests.has(d));
}

export async function checkWritingKey(
  key: WritingKey,
  response: QuestionResponse,
  hash: Digest,
): Promise<WritingKeyCheck> {
  const no: WritingKeyCheck = { isCorrect: false, almost: false, writing: null };
  switch (key.mode) {
    case "trace": {
      if (!("strokes" in response)) return no;
      if (response.typed !== undefined) {
        const ok = response.typed.trim() === key.glyph.character;
        return {
          isCorrect: ok,
          almost: !ok && response.typed.trim().toLowerCase() === key.glyph.character.toLowerCase(),
          writing: null,
        };
      }
      const v = traceVerdict(
        key.glyph,
        key.traceMode,
        evaluateTrace(key.glyph.strokes, response.strokes, key.settings),
        key.settings,
      );
      return { isCorrect: v.isCorrect, almost: v.almost, writing: v.analysis };
    }
    case "copy": {
      if (!("value" in response)) return no;
      const wordsRight = key.digests.includes(await hash(canonicalSentence(response.value)));
      const spacingOnly =
        !wordsRight &&
        canonicalSentence(response.value).length > 0 &&
        key.compact.includes(await hash(`~${compactWords(response.value)}`));
      const v = copyVerdict({
        actual: response.value,
        expectedWords: key.words,
        wordsRight,
        spacingOnly,
        mechanics: key.mechanics,
        wordCategory: null,
        wordAlmost: false,
      });
      return { isCorrect: v.isCorrect, almost: v.almost, writing: v.analysis };
    }
    case "complete": {
      if (!("value" in response)) return no;
      const ok = key.digests.includes(await hash(canonicalCompletion(response.value)));
      return { isCorrect: ok, almost: false, writing: null };
    }
    case "edit": {
      if (!("value" in response)) return no;
      if (key.digests.includes(await hash(canonicalEdit(response.value))))
        return { isCorrect: true, almost: false, writing: null };
      const changed = canonicalEdit(response.value) !== key.original;
      return {
        isCorrect: false,
        almost: changed && key.words.includes(await hash(`~${canonicalSentence(response.value)}`)),
        writing: null,
      };
    }
    case "rubric": {
      const lines = "lines" in response ? response.lines : "value" in response ? [response.value] : null;
      if (!lines) return no;
      const full = withStarters(
        lines,
        key.starters.map((starter) => ({ starter })),
      );
      const whole = full.filter(Boolean).join(" ");
      const v = evaluateRubric({
        criteria: key.criteria,
        lines: full,
        match: await digestMatcher(whole, hash),
        firstSentenceMatch: await digestMatcher(writtenSentences(whole)[0] ?? "", hash),
        context: key.settings,
      });
      return { isCorrect: v.isCorrect, almost: v.almost, writing: v.analysis };
    }
    case "story": {
      if (!("lines" in response) || !response.order) return no;
      const orderOk = key.orders.includes(await hash(orderForm(response.order)));
      const texts = new Set<string>();
      const whole = response.lines.join(" ");
      for (const t of [...response.lines, whole]) {
        texts.add(t);
        texts.add(writtenSentences(t)[0] ?? "");
      }
      const matchers = new Map<string, PhraseMatcher>();
      for (const t of texts) matchers.set(t, await digestMatcher(t, hash));
      const v = evaluateStoryWriting({
        // The order is checked by digest above; the evaluator sees it as given or not.
        acceptedOrders: orderOk ? [response.order] : [],
        sequence: response.order,
        lines: response.lines,
        eventCriteria: key.eventCriteria,
        criteria: key.criteria,
        matcherFor: (t) => matchers.get(t) ?? (() => false),
        context: key.settings,
      });
      return { isCorrect: v.isCorrect, almost: v.almost, writing: v.analysis };
    }
  }
}
