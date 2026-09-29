"use client";

import type { ComponentType } from "react";
import type { RendererProps } from "./types";
import type { RENDERABLE_QUESTION_TYPES } from "./supported-types";
import { ChoiceRenderer } from "./renderers/choice";
import { IntroRenderer } from "./renderers/intro";
import { MissingLetterRenderer } from "./renderers/missing-letter";
import { SentenceBuilderRenderer } from "./renderers/sentence-builder";
import { SpellingRenderer } from "./renderers/spelling";
import { WordBuilderRenderer } from "./renderers/word-builder";

// Activity type → renderer. The lesson player looks the step's type up here; adding a new
// activity type means adding one entry (plus its schema and evaluator), not a new page.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ACTIVITY_RENDERERS: Record<
  (typeof RENDERABLE_QUESTION_TYPES)[number],
  ComponentType<RendererProps<any>>
> = {
  INTRO: IntroRenderer,
  MULTIPLE_CHOICE: ChoiceRenderer,
  LISTEN_AND_CHOOSE: ChoiceRenderer,
  PICTURE_MATCH: ChoiceRenderer,
  MISSING_LETTER: MissingLetterRenderer,
  WORD_BUILDER: WordBuilderRenderer,
  SENTENCE_BUILDER: SentenceBuilderRenderer,
  SPELLING: SpellingRenderer,
};
