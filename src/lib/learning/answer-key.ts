import type { AnswerSpec, QuestionResponse } from "@/lib/content/question-schemas";
import type { ClientQuestion } from "@/lib/learning/lesson-payload";
import {
  canonicalAccepted,
  canonicalOption,
  canonicalPair,
  canonicalPosition,
  canonicalSequence,
  canonicalValue,
  isAlmostShare,
  sortedLetters,
} from "@/lib/learning/evaluate";
import { sha256 } from "@/lib/learning/sha256";
import { punctuationCheck } from "@/lib/learning/spelling";
import type { TraceGlyph } from "@/lib/learning/tracing";
import type { WritingAnalysis } from "@/lib/learning/writing";
import { WRITING_QUESTION_TYPES, type WritingSettings } from "@/lib/learning/writing-evaluation";
import {
  buildWritingKey,
  checkWritingKey,
  WRITING_KEY_MODES,
  type WritingKey,
} from "@/lib/learning/writing-key";

// Correct answers never travel to the device in plain text. The lesson loader turns each
// question's answer into an AnswerKey of salted SHA-256 digests of the answer's canonical
// forms (the same forms evaluate.ts compares). The device can then check a response — and
// tell a near miss — offline, and after the last try it can recover the answer only by
// testing the options already on screen. The server re-evaluates every stored answer
// against the real answer, so a modified client cannot forge progress (ADR-021).

export type AnswerKey =
  | { mode: "none" }
  // `punctuation`: sentence dictation also needs a capital letter and an end mark (not a
  // secret: it is a rule about the answer's form, checked on the device as on the server).
  | { mode: "values"; salt: string; digests: string[]; letters: string[]; punctuation?: boolean }
  | { mode: "sequence"; salt: string; digests: string[]; positions: string[] }
  | { mode: "pairs"; salt: string; digests: string[] }
  // Select-all: one digest per right option; `count` of them.
  | { mode: "set"; salt: string; digests: string[]; count: number }
  // Writing (writing-key.ts): handwriting, copying, finishing and correcting sentences,
  // open-ended writing by rubric, story writing.
  | WritingKey;

// `writing`: what the device found in a written answer (the checklist shown after it).
export type KeyCheck = { isCorrect: boolean; almost: boolean; writing?: WritingAnalysis | null };

const DIGEST_HEX_LENGTH = 24;

export async function digest(salt: string, value: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}\u0000${value}`);
  const hash =
    typeof crypto !== "undefined" && crypto.subtle
      ? new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
      : sha256(bytes);
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, DIGEST_HEX_LENGTH);
}

const LETTER_TYPES = new Set(["WORD_BUILDER", "SPELLING"]);

// `writing`: the writing question types also need the question's content, the glyph for
// handwriting and the level's writing settings.
export async function buildAnswerKey(
  questionType: string,
  answer: AnswerSpec | null,
  salt: string,
  writing?: { content: unknown; glyph?: TraceGlyph | null; settings: WritingSettings },
): Promise<AnswerKey> {
  if (answer === null) return { mode: "none" };
  if (WRITING_QUESTION_TYPES.has(questionType)) {
    if (!writing) return { mode: "none" };
    const key = await buildWritingKey({
      questionType,
      answer,
      content: writing.content,
      salt,
      hash: (v) => digest(salt, v),
      glyph: writing.glyph,
      settings: writing.settings,
    });
    return key ?? { mode: "none" };
  }
  if (!("pairs" in answer || "correct" in answer || "acceptedSequences" in answer || "accepted" in answer))
    return { mode: "none" };
  const hash = (values: string[]) => Promise.all([...new Set(values)].map((v) => digest(salt, v)));
  if ("pairs" in answer) return { mode: "pairs", salt, digests: await hash(answer.pairs.map(canonicalPair)) };
  if ("correct" in answer) {
    const digests = await hash(answer.correct.map(canonicalOption));
    return { mode: "set", salt, digests, count: digests.length };
  }
  if ("acceptedSequences" in answer) {
    return {
      mode: "sequence",
      salt,
      digests: await hash(answer.acceptedSequences.map(canonicalSequence)),
      // In order, so position i of the first accepted sequence is positions[i].
      positions: await Promise.all(
        answer.acceptedSequences[0].map((t, i) => digest(salt, canonicalPosition(i, t))),
      ),
    };
  }
  const accepted = canonicalAccepted(questionType, answer.accepted);
  return {
    mode: "values",
    salt,
    digests: await hash(accepted),
    letters: LETTER_TYPES.has(questionType) ? await hash(accepted.map((a) => `~${sortedLetters(a)}`)) : [],
    ...("requirePunctuation" in answer && answer.requirePunctuation ? { punctuation: true } : {}),
  };
}

export async function checkWithKey(
  questionType: string,
  key: AnswerKey,
  response: QuestionResponse,
): Promise<KeyCheck> {
  const no = { isCorrect: false, almost: false };
  if (WRITING_KEY_MODES.has(key.mode)) {
    const w = key as WritingKey;
    return checkWritingKey(w, response, (v) => digest("salt" in w ? w.salt : "", v));
  }
  switch (key.mode) {
    case "none":
      return { isCorrect: true, almost: false };
    case "pairs": {
      if (!("pairs" in response)) return no;
      const given = [...new Set(response.pairs.map(canonicalPair))];
      const hashes = await Promise.all(given.map((p) => digest(key.salt, p)));
      const right = hashes.filter((h) => key.digests.includes(h)).length;
      const total = key.digests.length;
      return right === total && response.pairs.length === total
        ? { isCorrect: true, almost: false }
        : { isCorrect: false, almost: isAlmostShare(right, total) };
    }
    case "set": {
      if (!("sequence" in response)) return no;
      const given = [...new Set(response.sequence.map(canonicalOption))];
      const hashes = await Promise.all(given.map((o) => digest(key.salt, o)));
      const wrong = hashes.filter((h) => !key.digests.includes(h)).length;
      if (wrong === 0 && given.length === key.count) return { isCorrect: true, almost: false };
      return { isCorrect: false, almost: wrong === 0 && given.length > 0 };
    }
    case "sequence": {
      if (!("sequence" in response)) return no;
      if (key.digests.includes(await digest(key.salt, canonicalSequence(response.sequence))))
        return { isCorrect: true, almost: false };
      const hashes = await Promise.all(
        response.sequence
          .slice(0, key.positions.length)
          .map((t, i) => digest(key.salt, canonicalPosition(i, t))),
      );
      const right = hashes.filter((h, i) => h === key.positions[i]).length;
      return { isCorrect: false, almost: isAlmostShare(right, key.positions.length) };
    }
    case "values": {
      const value = canonicalValue(questionType, response);
      if (value === null) return no;
      if (key.digests.includes(await digest(key.salt, value))) {
        if (key.punctuation && "value" in response) {
          const marks = punctuationCheck(response.value);
          if (!marks.capital || !marks.end) return { isCorrect: false, almost: true };
        }
        return { isCorrect: true, almost: false };
      }
      const almost =
        key.letters.length > 0 && key.letters.includes(await digest(key.salt, `~${sortedLetters(value)}`));
      return { isCorrect: false, almost };
    }
  }
  return no;
}

// What to show once the tries are used up. Recovered by testing what is on screen
// (options, choices, bank words, tiles in each position); the spoken word for listening
// types is already part of the question.
export type Reveal = {
  text: string;
  optionId?: string;
  value?: string;
  sequence?: string[];
  pairs?: [string, string][];
};

export async function revealAnswer(question: ClientQuestion, key: AnswerKey): Promise<Reveal | null> {
  if (key.mode === "none") return null;
  if (key.mode === "trace") return { text: key.glyph.character };
  // A sentence to copy is on screen; other writing has no single answer to show (the
  // explanation and the checklist say what to do).
  if (key.mode === "copy")
    return question.type === "SENTENCE_WRITING" ? { text: question.content.model ?? "" } : null;
  if (WRITING_KEY_MODES.has(key.mode)) return null;
  const matches = async (value: string) => {
    if (key.mode === "values") return key.digests.includes(await digest(key.salt, value));
    return false;
  };

  switch (question.type) {
    case "MULTIPLE_CHOICE":
    case "LISTEN_AND_CHOOSE":
    case "PICTURE_MATCH":
    case "READING":
    case "BLEND_SOUNDS": {
      for (const option of question.content.options) {
        if (await matches(canonicalValue(question.type, { value: option.id })!)) {
          return { text: option.text ?? option.speech ?? option.id, optionId: option.id };
        }
      }
      return null;
    }
    case "MISSING_LETTER": {
      for (const choice of question.content.choices) {
        if (await matches(canonicalValue(question.type, { value: choice })!))
          return { text: question.content.word, value: choice };
      }
      return null;
    }
    case "WORD_BUILDER":
    case "SPELLING":
      return question.content.speech ? { text: question.content.speech } : null;
    case "SENTENCE_DICTATION":
      return { text: question.content.speech };
    case "WRITING": {
      const starter = question.content.starter?.trim();
      for (const word of question.content.wordBank) {
        const candidate = starter ? `${starter} ${word}` : word;
        for (const c of [candidate, word]) {
          if (await matches(canonicalValue("WRITING", { value: c })!)) {
            return { text: candidate, value: c };
          }
        }
      }
      return null;
    }
    case "FIND_PATTERN": {
      const word = question.content.word;
      for (let start = 0; start < word.length; start++) {
        for (let end = start; end < word.length; end++) {
          const span = `${start}-${end}`;
          if (await matches(canonicalValue(question.type, { value: span })!))
            return { text: word.slice(start, end + 1), value: span };
        }
      }
      return null;
    }
    case "SEGMENT_WORD": {
      if (key.mode !== "sequence") return null;
      const sequence: string[] = [];
      for (let i = 0; i < key.positions.length; i++) {
        let found: string | undefined;
        for (const sound of question.content.sounds) {
          if ((await digest(key.salt, canonicalPosition(i, sound.id))) === key.positions[i]) {
            found = sound.id;
            break;
          }
        }
        if (found === undefined) return null;
        sequence.push(found);
      }
      const labels = sequence.map((id) => question.content.sounds.find((s) => s.id === id)!.label);
      return { text: `${sequence.length} sounds: ${labels.map((l) => `/${l}/`).join(" ")}`, sequence };
    }
    case "SENTENCE_BUILDER":
    case "DRAG_DROP": {
      if (key.mode !== "sequence") return null;
      const pool = question.type === "SENTENCE_BUILDER" ? question.content.tokens : question.content.bank;
      const sequence: string[] = [];
      for (let i = 0; i < key.positions.length; i++) {
        let found: string | undefined;
        for (const token of pool) {
          if ((await digest(key.salt, canonicalPosition(i, token))) === key.positions[i]) {
            found = token;
            break;
          }
        }
        if (found === undefined) return null;
        sequence.push(found);
      }
      if (question.type === "SENTENCE_BUILDER") return { text: sequence.join(" "), sequence };
      let blank = 0;
      const text = question.content.parts
        .map((p) => ("blank" in p ? sequence[blank++] : p.text))
        .join(" ")
        .replace(/\s+([.,!?])/g, "$1");
      return { text, sequence };
    }
    case "SELECT_ALL": {
      if (key.mode !== "set") return null;
      const right = [];
      for (const option of question.content.options)
        if (key.digests.includes(await digest(key.salt, canonicalOption(option.id)))) right.push(option);
      return {
        text: right.map((o) => o.text ?? o.id).join(", "),
        sequence: right.map((o) => o.id),
      };
    }
    case "ORDER_EVENTS": {
      if (key.mode !== "sequence") return null;
      const sequence: string[] = [];
      for (let i = 0; i < key.positions.length; i++) {
        let found: string | undefined;
        for (const event of question.content.events) {
          if ((await digest(key.salt, canonicalPosition(i, event.id))) === key.positions[i]) {
            found = event.id;
            break;
          }
        }
        if (found === undefined) return null;
        sequence.push(found);
      }
      return { text: "", sequence };
    }
    case "MATCH":
    case "SORT": {
      if (key.mode !== "pairs") return null;
      const lefts = question.type === "MATCH" ? question.content.left : question.content.items;
      const rights = question.type === "MATCH" ? question.content.right : question.content.groups;
      const pairs: [string, string][] = [];
      for (const l of lefts) {
        for (const r of rights) {
          if (key.digests.includes(await digest(key.salt, canonicalPair([l.id, r.id])))) {
            pairs.push([l.id, r.id]);
            break;
          }
        }
      }
      return { text: "", pairs };
    }
    default:
      return null;
  }
}
