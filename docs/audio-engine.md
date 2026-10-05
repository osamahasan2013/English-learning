# Audio engine — playback lifecycle and pacing

How sound is played (Phase 8.1), paced for children (Phase 8.2) and kept semantically
exact (Phase 8.3). **What** is said (tokens, the pronunciation resolver, the pronunciation
matrix) is in [audio.md](audio.md). Decision records: ADR-043 (lifecycle), ADR-044
(intents, pacing, recorded audio), ADR-045 (letter names, sounds and function words).

There is one audio system: `src/lib/audio/` — `pronunciation.ts` (pure: text → clips and
utterances, each tagged speech / phoneme / letter name), `pacing.ts` (pure: intents and
the per-level pace, text → pieces), `audio-service.ts` (the only code that touches
`speechSynthesis` and `Audio`), `use-audio.ts` (the React hook and the sound-table and
pacing providers) and `audio-check.ts` (the grown-ups' listening test). Phonics,
vocabulary, spelling, reading and writing all use it; no component calls a browser audio
API, and no component holds a speed or a pause.

## Audio intents

Every request says what it teaches (`AudioRequest.intent`, default `INSTRUCTION`). The
intent decides the pacing, never the words:

| Intent          | Used for                                    | Pacing                                                            |
| --------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| `INSTRUCTION`   | prompts, explanations, intros               | level pace; Slow in phrases (never word by word)                  |
| `FEEDBACK`      | "Great job!", "Start with a capital letter" | as INSTRUCTION                                                    |
| `WORD`          | a whole word ("gate")                       | one piece at the level's rate — **never spelled out**             |
| `SENTENCE`      | a sentence to hear (a word's example)       | level pace (sentence / phrase / word)                             |
| `STORY_READING` | a story read aloud                          | level pace; the highlight follows each piece                      |
| `LETTER_NAME`   | a letter's name (the capital: "G")          | phonics rate alone ("G."); inside a sentence, in the sentence     |
| `PHONEME`       | a sound (/g/ → "guh")                       | phonics rate alone; a run of sounds is split into pieces          |
| `SEGMENTING`    | sequence: a word's sounds one by one        | `itemGapMs` between the sounds                                    |
| `BLENDING`      | sequence: the sounds, then the whole word   | `itemGapMs` between the sounds, `wordGapMs` before the whole word |

Segmenting and blending are explicit (`PlayOptions.sequence`): a word is only ever broken
into sounds when an activity asks for it. Inside a text, a **run** of sound tokens (two or
more with only punctuation between them) becomes separate parts (`planSpeech`) with
`tokenGapMs` of silence around them, so "gate. {/G/}, {/EY/}, {/T/}. gate." is heard as five
pieces — "gate … guh … eigh … tuh … gate" — not one breath that sounds like "gate g a t
gate". A single sound or a letter name inside a sentence stays in the sentence ("This is
the letter G." / "It says guh, as in goat."): said alone it would be a one-syllable
utterance, which is what iOS mispronounced or clipped (Phase 8.3, below). A token that is
the whole text, and any recording, is a part of its own. A part keeps its role (speech /
phoneme / letter_name) all the way to the engine (and to the timing log): a sound is
resolved by `resolveSound` and can never become a letter name; a letter name by
`resolveLetter` and never shares a clip with the sound.

## Semantic accuracy (Phase 8.3)

On a real iPhone the letter name G was heard as "S", and "the" in reading sentences was
often unclear. What the voice was given (Phase 8.2) explains both: every letter-name token
was its own utterance of a spelled nonce word ("jee", "ess") — a one-syllable request with
no context, which voices pronounce unpredictably and iOS often clips at the onset ("jee"
without its start is close to "ee"; "ess" and "eff" differ only in the final consonant) —
and Slow at KG1 / KG2 spoke "The", "the" and "a" as utterances of their own, where voices
use a stressed or clipped form. The rules now:

| Meaning              | What the voice is given                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| LETTER_NAME          | the **capital letter** (`{@g}` → "G"; A–Z from `phonics.json`, `letterNameSayAs` = capital, validated); alone "G."                                                             |
| PHONEME              | the sound's rendering (`{/G/}` → "guh"), a keyword phrase, or nothing — **never** the letter or its name                                                                       |
| WORD                 | the word with a full stop ("gate.", "the.") — its whole citation form, never spelled or split                                                                                  |
| SEGMENTING/BLENDING  | each sound a request of its own; blending ends with the WORD                                                                                                                   |
| SENTENCE / STORY     | the level's pieces; **articles and possessives always stay with their noun** ("the gate", even word by word); in phrases no piece ends on a function word ("to", "of", "and"…) |
| INSTRUCTION/FEEDBACK | whole sentences at Normal, phrases of three words or more at Slow; a letter name never a piece on its own                                                                      |

- **Engine-native letter names.** Every engine has a lexicon entry for a capital letter;
  spelled names ("jee", "zee", "aitch") are guesses at nonce words. The name is rendered
  from the one A–Z table, never typed into content.
- **No raw letters.** A letter standing alone in speech ("s and h", "big C", "o-f") is a
  letter name by definition: content must say `{@s}` (or a sound token when it means the
  sound — "Does the {@s} say {/S/}, or {/Z/}?"). The importer rejects raw letters in
  question speech, lesson intros and activity instructions (`speechProblems`); generators
  emit tokens (`spellLetters`, `spellOut`, `speechFromDisplay`); at play time any left-over
  lone letter is rendered from the A–Z table (`lettersAsTokens`) — never handed to the
  voice raw. "a", "A" and "I" are words.
- **No letter name as a phoneme fallback.** A sound with no safe rendering is a keyword
  phrase ("the sound at the start of apple") or silence and `audio.token_unresolved`.
- `explainSpeech(text, table)` says, per token, its role, target, source (recorded / tts /
  keyword / none) and rendering — used by the audio check page and the tests.

High-frequency words ("the", "a", "an", "is", "to", "of", "and") use the ordinary word
path: in a sentence they lean on the next word; alone (a tapped word, a sight-word card)
they are a WORD in citation form ("the.") or a recording from `audio_assets`
(`word:the`). No word is replaced by another to hide a pronunciation.

## Reading pacing (the `audio` learning rules)

Browser voices do not reliably slow down from the rate alone: on a real iPhone, Safari
sounded nearly the same at 0.85 and 0.6. So pace is three things together — **rate**,
**piece size** (a sentence, a phrase of up to `maxWords`, or a word) and **pauses**
(between pieces, and between sentences). Slow is slower on every engine because it reads
smaller pieces with pauses, whatever the engine does with the rate. Rates stay at 0.6 or
above (lower distorts some voices). Values live in `rules.ts` (`audio`), overridable per
level in `learning_rules` (code `audio`); lesson payloads carry their level's pace (also
offline) and the child layout provides the child's level elsewhere.

| Level   | Normal                                  | Slow                                    |
| ------- | --------------------------------------- | --------------------------------------- |
| KG1     | 0.78, phrases ≤ 4 words, 200 ms, 600 ms | 0.62, word by word, 380 ms, 900 ms      |
| KG2     | 0.80, phrases ≤ 4 words, 180 ms, 550 ms | 0.64, word by word, 340 ms, 850 ms      |
| KG3     | 0.83, whole sentences, —, 500 ms        | 0.66, phrases ≤ 2 words, 350 ms, 800 ms |
| Grade 1 | 0.88, whole sentences, —, 450 ms        | 0.70, phrases ≤ 2 words, 330 ms, 750 ms |
| Grade 2 | 0.92, whole sentences, —, 400 ms        | 0.74, phrases ≤ 2 words, 300 ms, 700 ms |

(rate, piece, pause between pieces, gap between sentences). Phonics, every level: sound /
letter-name rate 0.75 (Slow 0.6), `tokenGapMs` 350 (600), `itemGapMs` 450 (750),
`wordGapMs` 650 (1000).

Why: read-aloud for early readers is about 90–120 words a minute and "slow, pointing at
each word" about 50–70; adult conversation is 150+. The youngest hear short phrases at
Normal (natural, with breathing room) and single words at Slow (the "finger under each
word" reading teachers model); from KG3 Normal is whole sentences, and Slow pairs of words —
deliberate but still phrased, not robotic. For "The cat is at the gate." Slow adds at
least 560 ms of silence at every level (1.9 s at KG1) on top of the lower rate, so it is
audibly slower even on an engine that ignores the rate. Phrases are chosen as a whole per
clause (balanced, close to `maxWords`: "The cat is | at the gate.", not "The cat | is at
the gate."), never split a function word from its word ("to the park." stays together;
word-by-word Slow reads "The cat | is | at | the gate."), and punctuation stays on its word
so intonation is kept.

The service reports each piece as it starts (`onChunk`), so the story highlight follows
the words being said; the request ids of 8.1 keep an interrupted reading from
highlighting anything.

## Recorded audio

Recordings are first-class and optional (production has none yet; nothing is
fabricated). Order: **recorded clip → (cached clip, via the service worker) → speech
synthesis of the resolver's rendering → keyword → nothing**, then `unavailable`.
`audio_assets` (Phase 8.2 migration `20261010100100`) holds each take: `kind`
(letter_name, phoneme, word, sentence, instruction, story, blending, segmenting,
dictation, plus the older word / letter / phonics), `content_key` (`phoneme:SH`,
`letter_name:g`, `pattern_sound:AI`, `word:gate` — unique per `version`), `version`,
`locale`, `voice` (speaker), `duration_ms`, `storage_path`, `status`, `metadata`. What a
clip records is a link from that thing: `phonemes.audio_asset_id` (a sound everywhere it
appears), `phonics_pattern_sounds` / `phonics_patterns.audio_asset_id` (digraphs, vowel
teams, r-controlled vowels, endings), **`phonics_patterns.letter_name_audio_asset_id`**
(a letter's NAME, separate from its sound), `words`, `sentences`, `spelling_words`
(dictation), `stories`, `questions`, `lessons`. Authoring: `phonemes[].audio`,
`patterns[].audio` and `patterns[].letterNameAudio` in `phonics.json`, `audio` columns in
the CSVs. No component changes when recordings arrive.

## Sources and resolution

Production today has **no recorded clips** (`audio_assets` is empty), so everything is
browser speech synthesis. The chain is deterministic, per request and per token:

1. **Recorded clip** for the whole request (`assetUrl`) or for a token (a phoneme,
   pattern sound or letter clip in the sound table).
2. **Speech synthesis** of the resolver's rendering (`suh`, `ee`, `shun`, the word, the
   sentence). A clip that fails (missing file, offline, blocked) falls back to this.
3. **Keyword** for sounds no voice can say ("the sound at the start of apple").
4. **Nothing** for a token with no safe rendering — the rest of the text is still said,
   and `audio.token_unresolved` is logged. Broken tokens (`{sound}`, an unclosed `{/S/`)
   are never read aloud; hand-made tokens in the wrong case or with spaces (`{/sh/}`,
   `{@S}`) are read like the canonical ones, so a typo never becomes letter names.
5. **Unavailable**: when nothing could be heard the request returns `unavailable`, the
   screen shows "Audio isn't available right now. Try again, or read the words." and the
   lesson carries on (text is always on screen; nothing waits for audio).

`playAudio` returns `played`, `interrupted` (a newer request or leaving stopped it — not a
failure) or `unavailable`. It never throws.

## Speech synthesis

- **Voices** load asynchronously (Chrome, Safari). The voice is chosen when the list
  arrives (`voiceschanged`) and re-read at every request (some Safari versions never send
  `voiceschanged`); an empty list never replaces a chosen voice. Choice: en-US, a voice
  **on the device** first (Samantha, Aria…), online voices (Chrome's "Google US English")
  only when nothing else exists — they need the network, stop long utterances after about
  15 seconds and lose utterances after a cancel. A voice that fails (`network`,
  `voice-unavailable`, …) is retried once with the device's default voice.
- **Language** `en-US`; **rate and pauses** from the level's pace (above; recorded clips:
  playbackRate 0.75 for Slow); **pitch** 1; **volume** 1 (`SPEECH_SETTINGS`).
- **Pieces**: text is read in the level's pieces (`chunkText`); any piece longer than 200
  characters is split at phrases (Chrome's online voices stop long utterances).
- **Paused engine** (Android Chrome after the app was in the background): `resume()`
  before speaking.
- `pause()`/`resume()` are not offered to children: Stop and Listen (from the start) are
  simpler and work the same on every engine.

## Request identity and cancellation

Every request gets an id (`lastId`), and the newest one is `current`. `stopAudio()` also
moves `current` on. Every callback checks its id before it changes anything: a cut-short
request's late `end`/`error` events, its `onItem` highlights and its result can never
touch the newer request. Example: Listen is request #17; Slow makes #18 current; #17's
utterance reports "interrupted" a moment later — #17 returns `interrupted`, and the
playback state, highlighting and buttons stay with #18.

Stopping is not instant on every engine:

- desktop Chrome processes `cancel()` at once;
- **WebKit (iOS/macOS Safari) and Android Chrome process it after the current task and
  take any utterance spoken right after it with them.** Before Phase 8.1 the new
  utterance was spoken in the same tick as `cancel()`, so it was lost — and its
  "canceled" error was counted as played, so nothing showed.

So starting a request:

1. makes it current and stops the clip;
2. if **our** utterance is still on the engine, calls `cancel()` and **waits until the
   engine reports that utterance gone** (its `end`/`error`, at most 300 ms), plus one
   task; if nothing is playing it speaks **in the same tick** — still inside the child's
   tap, which iOS requires for the first sound;
3. speaks. An utterance that is still lost while its request is current ("canceled"
   without a newer request, an `end` within 100 ms with no `start`, or no `start` within
   4 s) is **said once more**; a second failure is reported, never retried for ever.
4. An `end` that never comes (some engines) cannot hang a request: it is assumed after
   twice the expected speaking time. The utterance stays referenced while it plays
   (Chrome stops reporting events for a garbage-collected utterance).

Recorded clips use one reusable `<audio>` element (once a tap has started it, iOS lets it
play again later); stopping pauses it and releases the waiting request. A clip and speech
never play together: every request stops both before it starts.

## Playback state

One store in the service, read with `useSyncExternalStore` (`useAudioSnapshot`, and
`useAudio().state` / `speaking` for a screen's own request):

```
idle ──request──▶ loading ──engine "start" / clip "playing"──▶ playing ──end──▶ idle
                     │                                            │
                     └──────────── nothing heard ─────────────────┴──▶ unavailable
any state ──newer request──▶ loading (new id)        any state ──stopAudio──▶ idle
```

`loading` covers "the engine is letting go of the previous sound" and "a clip is
loading". The snapshot carries the request id, the owner and the source (`asset`/`tts`).
Children never see the states by name: the buttons derive from them.

## Owners and component lifecycle

A screen's `useAudio()` is the **owner** of what it starts. Unmounting stops only its own
sound — a list item or panel that closes cannot cut off a sound another screen started.
The lesson player owns all lesson audio (renderers get its `speak`), so leaving a lesson,
changing child or navigating away stops it; a new question's prompt replaces the previous
sound; hiding the app (`visibilitychange`), locking the screen or leaving the page
(`pagehide`) stops everything. Components that track their own presses (`AudioControls`,
`PassageView`, dictation) keep a run counter and ignore results from older presses.

## The buttons

- **Listen** — the words from the beginning at the level's Normal pace (stops whatever
  was playing).
- **Slow** — the same words from the beginning at the level's Slow pace (lower rate,
  smaller pieces, pauses), same voice and language. Works after Listen, after Slow,
  during either, after Read it again or Try again.
- **Again** — repeats the last speed. Stays in place while playing (buttons do not move
  under a child's finger).
- **Stop** (⏹ "Stop audio") — appears while something plays.
- **Story** (`PassageView`): Listen reads it sentence by sentence (`STORY_READING`), in
  the level's pieces; the sentence is highlighted and, when it is read in phrases or word
  by word, so are the words being said; while it reads, Listen becomes **Start again**
  (from sentence 1, no duplicate voice). A tapped word (`WORD`) replaces the reading and
  the buttons reset. Highlighting follows the pieces the engine is given: browser voices
  give no finer timing, so within a piece it is not word-perfect, and a whole-story
  recording plays without highlighting.
- **Blend** (word builder, Word Explorer): the word's sounds from its **grapheme split**
  (g · a · t · e → /G/ /EY/ /T/, silent e says nothing — never a letter's usual sound,
  so the a of gate is not "the a of apple"), then the whole word (`BLENDING`).
- **Read it again** — the text goes back to the top. If the child listened (or the story
  is listen-first) it is read aloud again from sentence 1 at the child's last speed;
  otherwise any reading still going is stopped and the child reads it again. The replay
  is part of the re-read (not counted as an extra listen).
- **Try again** (lesson player) — opens the next try of the same question
  (`sessionReducer` `retry`, a no-op unless the step is waiting for a retry, so a double
  press does nothing). It records nothing: attempts are recorded only when an answer is
  checked, so no duplicate attempt, mastery change or review item. The question is read
  aloud again, replacing the feedback that may still be playing.
- **Dictation** — a listen that could not be heard does not use up one of the limited
  plays.

## Mobile autoplay and iOS

- Browsers only allow speech after the user has interacted with the page (Chrome's
  `not-allowed` error before that). iOS also requires the **first** utterance to start
  inside a tap. The service speaks in the same tick when nothing is playing, and the
  first tap anywhere speaks one silent, empty utterance to unlock speech for the page, so
  a question read aloud when it appears (after loading) is heard too.
- Nothing is retried in the background to get around autoplay rules: a refused request is
  reported (`unavailable`, logged as `audio.tts_failed` with the error).
- Hiding the app or locking the screen cancels speech (iOS otherwise leaves the engine
  stuck); returning shows the buttons ready to play again.

## Offline

- Speech synthesis with an on-device voice works offline; lessons cached on the device
  carry their sound table, so tokens resolve offline too.
- An online voice offline fails with `network`: retried with the default voice; if there
  is none, `unavailable` and the note.
- A recorded clip that is not cached fails → speech synthesis. Audio failure never blocks
  an activity.

## Audio check (real devices)

`/parent/audio-check` (linked from parent Settings) plays fixed test lines through the
same service, voices and pacing children get, grouped by meaning: **letter names** A, G,
S, T; **sounds** /g/ /s/ /m/ /t/; **words** gate, cat, the; a **sentence**; five
**reading** sentences ("The cat is at the gate." …) at Normal and Slow; **segmenting** and
**blending** "gate"; the "gate" spelling intro and the letter-G intro. Each test shows what
it is for (intent, target), where its sound comes from (recorded / device voice /
keyword, from `explainSpeech`), the voice and locale, and in an expandable section the
token-by-token rendering and what the engine did (rate, pieces, paced silence, elapsed and
speaking time, outcome, retries). The grown-up marks PASS or FAIL with an optional note;
"Copy results" gives one line per test (test id, level, verdict, intent, target, source,
note, timings) under a header with the timestamp, OS, browser, voice and locale
(`describeDevice`, `formatResults`) and the Slow / Normal ratio of each reading sentence.
This human listening test on an iPhone, an Android phone and a desktop browser is the
acceptance test for audio accuracy — the automated tests cannot hear. Nothing is stored
or sent; the timing log (`setAudioTimingLog`) is on only while the page is open, in
memory, and records no words (only their length).

## Recording priorities

`npm run audio:priorities` ranks every letter name, sound, pattern sound and
high-frequency / irregular word by importance, frequency in the content, TTS risk,
ambiguity and level, and writes the order to record clips in
([recording-priorities.md](recording-priorities.md), regenerated from the content).
Letter names (rhyming B/C/D/E/G/P/T/V/Z), keyword and approximate sounds and "the" / "a"
/ "and" / "to" / "is" / "of" / "an" come first. Nothing is recorded or invented here.

## Diagnostics

Structured console records, content-free (ids, codes, voice names, rates, lengths, token
codes — never the words, a child's answer or anything personal): `audio.utterance_lost`,
`audio.voice_failed`, `audio.tts_failed`, `audio.asset_failed`, `audio.token_unresolved`,
`audio.unavailable`, `audio.playback_error`. Development logs every record; production
only failures, at most 20 per page. In development each request also logs `audio.request`:
request id, intent, speed, level, the roles of its parts, its token codes (`{@g}`,
`{/G/}`), their sources, voice and language — never the words.

## Tests

- `tests/unit/audio-service.test.tsx` — a fake engine with immediate and **deferred**
  cancel: Slow during Listen, rapid presses, sequences, stale callbacks, lost and stuck
  utterances, refusals, late voices, voice fallback, paused engine, long text, the state
  machine, same-tick speaking, owners.
- `tests/unit/pronunciation.test.ts` — every token form (`{@s}`, `{@S}`, `{ @s }`, `{/s/}`,
  `{/S/}`, `{ /s/ }`, `{/sh/}`…), broken and unresolved tokens, letter names vs sounds
  with their roles (G, S, C, T), letter-name and sound clips never swapped.
- `tests/unit/audio-accuracy.test.ts` (Phase 8.3), against the real `phonics.json`: A–Z
  letter names (capital, never one of the letter's sounds), G and S in every mode (name,
  sound, word, segmenting, blending), "the" / "a" never a piece alone or at a piece end at
  any level and speed, letter names never a piece alone in instructions, raw letters
  rendered as names and rejected in content, token validation, `explainSpeech`, the audio
  check items and results. 59 of its 65 tests fail against the Phase 8.2 code.
- `tests/unit/audio-pacing.test.ts` — per-level pacing, Slow slower than Normal at every
  level by rate AND silence, pieces and word offsets, intents, rule overrides, the
  audio-check summary.
- `tests/unit/audio-service.test.tsx` (Phase 8.2 block) — "gate. {/G/}…" as five pieces
  with gaps, letter name vs sound to the engine, a word never spelled, blend gaps, KG1 /
  Grade 2 reading pieces and rates, highlight pieces, Slow mid-reading, the timing log.
- `tests/unit/audio-ui.test.tsx` — Listen/Slow/Again/Stop, Start again, a tapped word,
  Read it again, Try again.
- `tests/e2e/audio.spec.ts` with `tests/e2e/fake-speech.ts` — real lessons in Chromium
  with an instrumented engine (headless Chromium has no voices): deferred cancel on
  tablet, phone and desktop sizes, immediate cancel, phonics tokens, no voices, the
  magic-e spelling intro as separate pieces, and the audio check page (KG1 Normal vs Slow
  pieces and ratio, letter name / sound / word / segmenting / blending, copied results).
  These prove behaviour (pieces, rates, gaps, order, no overlap) — **not** how a real
  voice sounds. That is the audio check on real devices.

## Known browser limitations

- Real devices were **not** tested from the development environment (no audio output,
  no Safari/iOS); the engine behaviours above are modelled in tests from documented
  WebKit/Chrome behaviour and must be checked on devices with the audio check page.
- iOS Safari: the rate makes little audible difference (reported on a real iPhone), which
  is why Slow relies on pieces and pauses; each utterance also adds a small start-up gap
  of its own on iOS, so word-by-word reading is a little slower there than the numbers.
- The iPhone "G heard as S" and unclear "the" are explained by what the voice was given
  (one-syllable, context-free utterances) and fixed by construction; whether a particular
  iOS voice now sounds right can only be confirmed with the audio check on the device.
- Voice choice is a preference list (on-device en-US voices such as Samantha / Aria first,
  then any en-US, then any English voice) — never a hard-coded single voice, so a device
  without the preferred voices still gets its best local voice.
- Isolated consonants from speech synthesis are approximate ("guh"); only recordings give
  pure sounds. Long a /EY/ sounds like the letter name A — that is correct phonics ("a_e
  says its name"), which is why the pieces must be separate.
- Voice quality and exact sound renderings depend on the device's voices.
- Sentence-level highlighting only (no word timing from browser voices).
- Firefox on Linux needs speech-dispatcher; without it there are no voices
  (`unavailable`).
