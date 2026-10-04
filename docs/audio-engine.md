# Audio engine — playback lifecycle

How sound is played (Phase 8.1). **What** is said (tokens, the pronunciation resolver, the
pronunciation matrix) is in [audio.md](audio.md). Decision record: ADR-043.

There is one audio system: `src/lib/audio/` — `pronunciation.ts` (pure: text → clips and
utterances), `audio-service.ts` (the only code that touches `speechSynthesis` and
`Audio`) and `use-audio.ts` (the React hook). Phonics, vocabulary, spelling, reading and
writing all use it; no component calls a browser audio API.

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
- **Language** `en-US`; **rate** 0.85, **Slow** 0.6 (recorded clips: playbackRate 0.75);
  **pitch** 1; **volume** 1 (`SPEECH_SETTINGS`).
- **Long text** is split into utterances of at most 200 characters at sentence, then
  phrase, then word boundaries (`splitForSpeech`), spoken in order.
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

- **Listen** — the words from the beginning at rate 0.85 (stops whatever was playing).
- **Slow** — the same words from the beginning at 0.6, same voice and language. Works
  after Listen, after Slow, during either, after Read it again or Try again.
- **Again** — repeats the last speed. Stays in place while playing (buttons do not move
  under a child's finger).
- **Stop** (⏹ "Stop audio") — appears while something plays.
- **Story** (`PassageView`): Listen reads sentence by sentence and highlights each one
  (word by word for Slow at the youngest levels); while it reads, Listen becomes
  **Start again** (from sentence 1, no duplicate voice). A tapped word replaces the
  reading and the buttons reset. Highlighting follows the engine's sentence (or word)
  boundaries: browser voices give no finer timing, so it is not word-perfect within a
  sentence, and a whole-story recording plays without highlighting.
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

## Diagnostics

Structured console records, content-free (ids, codes, voice names, rates, lengths, token
codes — never the words, a child's answer or anything personal): `audio.utterance_lost`,
`audio.voice_failed`, `audio.tts_failed`, `audio.asset_failed`, `audio.token_unresolved`,
`audio.unavailable`, `audio.playback_error`. Development logs every record; production
only failures, at most 20 per page.

## Tests

- `tests/unit/audio-service.test.tsx` — a fake engine with immediate and **deferred**
  cancel: Slow during Listen, rapid presses, sequences, stale callbacks, lost and stuck
  utterances, refusals, late voices, voice fallback, paused engine, long text, the state
  machine, same-tick speaking, owners.
- `tests/unit/pronunciation.test.ts` — every token form, broken and unresolved tokens,
  letter names vs sounds.
- `tests/unit/audio-ui.test.tsx` — Listen/Slow/Again/Stop, Start again, a tapped word,
  Read it again, Try again.
- `tests/e2e/audio.spec.ts` with `tests/e2e/fake-speech.ts` — real lessons in Chromium
  with an instrumented engine (headless Chromium has no voices): deferred cancel on
  tablet, phone and desktop sizes, immediate cancel, phonics tokens, no voices.

## Known browser limitations

- Real devices were **not** tested from the development environment (no audio output,
  no Safari/iOS); the engine behaviours above are modelled in tests from documented
  WebKit/Chrome behaviour and should be checked on devices (see the Phase 8.1 report).
- Voice quality and exact sound renderings depend on the device's voices.
- Sentence-level highlighting only (no word timing from browser voices).
- Firefox on Linux needs speech-dispatcher; without it there are no voices
  (`unavailable`).
