"use client";

import type { ComponentType } from "react";
import type { RendererProps } from "./types";
import type { RENDERABLE_QUESTION_TYPES } from "./supported-types";
import { BlendSoundsRenderer } from "./renderers/blend-sounds";
import { ChoiceRenderer } from "./renderers/choice";
import { DragDropRenderer } from "./renderers/drag-drop";
import { FindPatternRenderer } from "./renderers/find-pattern";
import { IntroRenderer } from "./renderers/intro";
import { MatchRenderer } from "./renderers/match";
import { MissingLetterRenderer } from "./renderers/missing-letter";
import { ReadingRenderer } from "./renderers/reading";
import { SegmentWordRenderer } from "./renderers/segment-word";
import { SentenceDictationRenderer } from "./renderers/sentence-dictation";
import { SentenceBuilderRenderer } from "./renderers/sentence-builder";
import { SortRenderer } from "./renderers/sort";
import { SpellingRenderer } from "./renderers/spelling";
import { TracingRenderer } from "./renderers/tracing";
import { WordBuilderRenderer } from "./renderers/word-builder";
import { WritingRenderer } from "./renderers/writing";

// Activity type → renderer. The lesson player looks the step's type up here; adding a new
// activity type means adding one entry (plus its schema and evaluator), not a new page.
// Each renderer narrows RendererProps to its own question type; the registry holds them
// uniformly and the lesson player only passes a step to the renderer of its type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRenderer = ComponentType<RendererProps<any>>;

export const ACTIVITY_RENDERERS: Record<(typeof RENDERABLE_QUESTION_TYPES)[number], AnyRenderer> = {
  INTRO: IntroRenderer,
  MULTIPLE_CHOICE: ChoiceRenderer,
  LISTEN_AND_CHOOSE: ChoiceRenderer,
  PICTURE_MATCH: ChoiceRenderer,
  MISSING_LETTER: MissingLetterRenderer,
  WORD_BUILDER: WordBuilderRenderer,
  SENTENCE_BUILDER: SentenceBuilderRenderer,
  SPELLING: SpellingRenderer,
  MATCH: MatchRenderer,
  SORT: SortRenderer,
  DRAG_DROP: DragDropRenderer,
  READING: ReadingRenderer,
  WRITING: WritingRenderer,
  TRACING: TracingRenderer,
  BLEND_SOUNDS: BlendSoundsRenderer,
  SEGMENT_WORD: SegmentWordRenderer,
  FIND_PATTERN: FindPatternRenderer,
  SENTENCE_DICTATION: SentenceDictationRenderer,
};
