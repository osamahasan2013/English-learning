import type { StoryInput, StoryQuestionInput } from "@/lib/content/content-schemas";
import { seededShuffle } from "@/lib/content/templates";
import { paragraphsOf, normalizeReadingWord, type ReadingParagraph } from "@/lib/learning/reading";
import type { ReadingLevelRules } from "@/lib/learning/rules";

// Reading content (Phase 7): turns a story's compact, authored comprehension questions into
// ordinary questions (READING, SELECT_ALL, ORDER_EVENTS, MATCH) and builds the activities of
// a reading lesson — the `reading` lesson blueprint. Everything produced here goes through
// the same validation and import as hand-written questions (question-schemas.ts).

export class ReadingContentError extends Error {}

// A raw question as the importer's buildQuestion expects it (no template).
export type RawQuestion = {
  code: string;
  type: string;
  prompt: string;
  promptSpeech: string;
  explanation: string;
  content: Record<string, unknown>;
  answer: Record<string, unknown> | null;
  story?: string;
  word?: string;
  skill?: string;
  difficulty: number;
  metadata: Record<string, unknown>;
};

function checkRef(paragraphs: ReadingParagraph[], ref: [number, number] | undefined, where: string) {
  if (!ref) return undefined;
  const [p, s] = ref;
  if (!paragraphs[p]?.sentences[s])
    throw new ReadingContentError(`${where}: ref [${p}, ${s}] is not a sentence of the text`);
  return { paragraph: p, sentence: s };
}

function optionIds(options: { id: string }[], where: string) {
  const ids = options.map((o) => o.id);
  if (new Set(ids).size !== ids.length) throw new ReadingContentError(`${where}: option ids must be unique`);
  return new Set(ids);
}

// One comprehension question. `skillCode` is the curriculum skill (tagged with the
// question's reading skill) the answer counts towards; undefined leaves the lesson's skill.
export function comprehensionQuestion(
  story: Pick<StoryInput, "code" | "pages">,
  q: StoryQuestionInput,
  index: number,
  skillCode: string | undefined,
  paragraphs: ReadingParagraph[] = paragraphsOf(story.pages),
): RawQuestion {
  const code = q.code ?? `${story.code}-q${index + 1}`;
  const where = `question ${code}`;
  const ref = checkRef(paragraphs, q.ref, where);
  const base = {
    code,
    prompt: q.prompt,
    promptSpeech: q.promptSpeech || q.prompt,
    explanation: q.explanation,
    story: story.code,
    difficulty: q.difficulty,
    ...(skillCode ? { skill: skillCode } : {}),
    metadata: { readingSkill: q.skill },
  };
  switch (q.type) {
    case "CHOICE":
    case "WORD_MEANING": {
      const ids = optionIds(q.options, where);
      if (!ids.has(q.answer)) throw new ReadingContentError(`${where}: answer "${q.answer}" is not an option`);
      if (q.type === "WORD_MEANING") {
        const word = normalizeReadingWord(q.word);
        if (!paragraphs.some((p) => p.sentences.some((s) => s.words.includes(word))))
          throw new ReadingContentError(`${where}: "${q.word}" is not in the text`);
      }
      return {
        ...base,
        type: "READING",
        ...(q.type === "WORD_MEANING" ? { word: q.word } : {}),
        content: {
          format: q.type === "WORD_MEANING" ? "word_meaning" : "choice",
          ...(q.type === "WORD_MEANING" ? { focusWord: q.word } : {}),
          options: q.options.map((o) => ({ id: o.id, text: o.text, ...(o.emoji ? { emoji: o.emoji } : {}) })),
          ...(ref ? { ref } : {}),
        },
        answer: { accepted: [q.answer] },
      };
    }
    case "TRUE_FALSE":
      return {
        ...base,
        type: "READING",
        content: {
          format: "true_false",
          options: [
            { id: "yes", text: "Yes", emoji: "👍" },
            { id: "no", text: "No", emoji: "👎" },
          ],
          ...(ref ? { ref } : {}),
        },
        answer: { accepted: [q.answer ? "yes" : "no"] },
      };
    case "SELECT_ALL": {
      const ids = optionIds(q.options, where);
      const missing = q.answer.find((a) => !ids.has(a));
      if (missing) throw new ReadingContentError(`${where}: answer "${missing}" is not an option`);
      return {
        ...base,
        type: "SELECT_ALL",
        content: {
          options: q.options.map((o) => ({ id: o.id, text: o.text, ...(o.emoji ? { emoji: o.emoji } : {}) })),
          ...(ref ? { ref } : {}),
        },
        answer: { correct: q.answer },
      };
    }
    case "ORDER": {
      const events = q.events.map((e, i) => ({ id: `e${i + 1}`, text: e.text, ...(e.emoji ? { emoji: e.emoji } : {}) }));
      return {
        ...base,
        type: "ORDER_EVENTS",
        content: { events: seededShuffle(events, code, true) },
        answer: { acceptedSequences: [events.map((e) => e.id)] },
      };
    }
    case "MATCH": {
      const left = q.pairs.map((p, i) => ({ id: `l${i + 1}`, ...p.left }));
      const right = q.pairs.map((p, i) => ({ id: `r${i + 1}`, ...p.right }));
      return {
        ...base,
        type: "MATCH",
        content: { left, right: seededShuffle(right, code, true) },
        answer: { pairs: left.map((l, i) => [l.id, right[i].id]) },
      };
    }
  }
}

// ---- The reading lesson blueprint -------------------------------------------------------

type Stage = "explanation" | "demonstration" | "guided_practice" | "independent_practice" | "review";
export type ReadingActivity = {
  type: string;
  stage: Stage;
  title: string;
  instructions: string;
  instructionsSpeech: string;
  questions: Record<string, unknown>[];
  config?: Record<string, unknown>;
};

const QUESTION_ACTIVITY: Record<string, { title: string; instructions: string }> = {
  READING: { title: "Think about it", instructions: "Look back at the story if you need to." },
  SELECT_ALL: { title: "Choose all", instructions: "Choose all the right answers." },
  ORDER_EVENTS: { title: "What happened?", instructions: "Put what happened in order." },
  MATCH: { title: "Match it", instructions: "Match each one to its partner." },
};

// The steps of guided reading, each only when the text has what it needs: preview →
// words to know → the phonics pattern → read (listen first for the youngest; tap a word to
// hear it) → questions about the text → tricky words → read again.
export function readingLessonActivities(args: {
  story: StoryInput;
  // Reading skill code → curriculum skill code of the level.
  skills: ReadonlyMap<string, string>;
  level: ReadingLevelRules;
  // The first word of the text that uses each target pattern (from the importer's analysis).
  patternWords: ReadonlyMap<string, string>;
}): ReadingActivity[] {
  const { story, level } = args;
  const paragraphs = paragraphsOf(story.pages);
  const out: ReadingActivity[] = [];
  const add = (
    type: string,
    stage: Stage,
    title: string,
    instructions: string,
    questions: Record<string, unknown>[],
    config?: Record<string, unknown>,
  ) => out.push({ type, stage, title, instructions, instructionsSpeech: instructions, questions, ...(config ? { config } : {}) });

  const firstSentence = paragraphs[0]?.sentences[0]?.text ?? "";
  add("INTRO", "explanation", "Get ready", `Let's read ${story.title}.`, [
    {
      type: "INTRO",
      code: `${story.code}-preview`,
      prompt: "",
      promptSpeech: "",
      content: {
        heading: story.title,
        display: story.coverEmoji || story.title,
        body: story.summary,
        speech: [`Let's read ${story.title}.`, story.summary].filter(Boolean).join(" "),
        examples: [],
      },
      answer: null,
    },
  ]);
  if (story.focusWords.length > 0)
    add(
      "INTRO",
      "demonstration",
      "Words to know",
      "Listen to these words. You will read them in the story.",
      story.focusWords.map((word) => ({ template: "word_intro", word })),
    );
  for (const pattern of story.targetPatterns.slice(0, 1)) {
    const word = args.patternWords.get(pattern);
    if (!word) throw new ReadingContentError(`no word of the text uses target pattern ${pattern}`);
    add("FIND_PATTERN", "demonstration", "Sounds in the story", "Find the letters that make the sound.", [
      { template: "find_pattern", pattern, word },
    ]);
  }
  add(
    "READ_PASSAGE",
    "guided_practice",
    "Read",
    level.defaultMode === "listen_first" ? "Listen to the story, then read it." : "Read the story. Tap a word to hear it.",
    [
      {
        type: "READ_PASSAGE",
        code: `${story.code}-read`,
        prompt: level.defaultMode === "listen_first" ? "Listen, then read" : "Read the story",
        promptSpeech:
          level.defaultMode === "listen_first"
            ? "Tap Listen to hear the story. Then read it."
            : "Read the story. Tap a word if you need help.",
        content: { mode: level.defaultMode, highlight: level.highlight, selfCheck: true },
        answer: null,
      },
    ],
    { story: story.code },
  );
  // Questions grouped into activities by type, keeping their authored order.
  const questions = story.questions.map((q, i) => {
    const skill = args.skills.get(q.skill);
    if (!skill) throw new ReadingContentError(`no ${q.skill} skill at this level for question ${i + 1}`);
    return comprehensionQuestion(story, q, i, skill, paragraphs);
  });
  for (const q of questions) {
    const last = out.at(-1);
    if (last && last.type === q.type && last.stage === "independent_practice") last.questions.push(q);
    else {
      const meta = QUESTION_ACTIVITY[q.type];
      add(q.type, "independent_practice", meta.title, meta.instructions, [q], { story: story.code });
    }
  }
  if (story.practiceWords.length > 0)
    add(
      "LISTEN_AND_CHOOSE",
      "review",
      "Tricky words",
      "Listen, then tap the word.",
      story.practiceWords.map((word) => ({ template: "listen_pick_word", word })),
    );
  if (story.reread)
    add(
      "READ_PASSAGE",
      "review",
      "Read it again",
      "Read the story again. It gets easier every time!",
      [
        {
          type: "READ_PASSAGE",
          code: `${story.code}-reread`,
          prompt: "Read it again",
          promptSpeech: "Read the story again.",
          content: { mode: "reread", highlight: level.highlight, selfCheck: true },
          answer: null,
        },
      ],
      { story: story.code },
    );
  if (firstSentence === "") throw new ReadingContentError("the text has no sentences");
  return out;
}
