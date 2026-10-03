# Audio and pronunciation

How the app decides what to say, and why phonics sounds are never spoken as letters.

## Words for things that are easy to mix up

| Term                           | Meaning                                                     | Example                  | Where it lives                                                                   |
| ------------------------------ | ----------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------- |
| **Grapheme**                   | What is written: one or more letters that stand for a sound | `sh`, `igh`, `a_e`       | `phonics_patterns.pattern`, `word_segments.grapheme`                             |
| **Phoneme**                    | A speech sound, as an ARPAbet code (IPA alongside)          | `SH` = /ʃ/, `AE` = /æ/   | `phonemes`, `phonics_pattern_sounds.phonemes`, `word_segments.phonemes`          |
| **Letter name**                | What a letter is called in the alphabet                     | s → "ess", h → "aitch"   | `phonics_patterns.letter_name` / `letter_name_say_as`                            |
| **Speech-synthesis rendering** | Text a browser voice reads aloud to produce a sound         | /s/ → `suh`, /iː/ → `ee` | `phonemes.say_as`, `phonics_pattern_sounds.say_as`                               |
| **Recorded asset**             | A real audio file in Supabase Storage (`content-audio`)     | `audio/phonemes/s.mp3`   | `audio_assets` (+ `audio_asset_id` on phonemes, pattern sounds, patterns, words) |

A letter's **name** and its **sound** are different things and are stored and spoken
separately: "This is the letter ess. It says suh, as in sun."

## Speech tokens

Learning content never stores the text a voice should say for a sound. It stores a
**token**, resolved when it is played:

- `{/S/}`, `{/SH AH N/}` — a **sound**: a sequence of phonemes;
- `{@s}` — a **letter name**.

Example (a letter intro): `This is the letter {@s}. It says {/S/}, as in sun.`

The templates write tokens for every sound (blending units, segmenting cards, missing
sounds, pattern intros, "which one starts with …?" prompts, word-builder tiles, the Word
Explorer's sound strip). Authored speech in content files must use them too: the
importer and `npm test` reject speech containing a bare letter group (`sss`, `sh`, `th`,
`ng`, `st`…), because only the author knows whether the letters or the sound is meant.

Display text read aloud (a pattern's child explanation, an authored spelling hint) is
converted by `speechFromDisplay`: `/k/` becomes the sound token and a letter group such
as `ch` becomes letter names ("The ch in school says /k/." → "The C aitch in school says
kuh.").

## The resolver

`src/lib/audio/pronunciation.ts` (pure, unit-tested) resolves each token, in order:

1. **Recorded clip** — if the sound (phoneme, or a pattern's sound) has a published
   `audio_assets` file, it is played.
2. **Speech synthesis** — the rendering stored in the database, checked to produce the
   sound and never letter names. Quality is recorded per sound:
   - `pure` — the sound alone (`ee`, `oh`, `ah`, `er`, `ing`, `shun`, `eigh` for /eɪ/);
   - `approximate` — the sound plus a short "uh" (`suh`, `buh`, `shuh`, `thuh`). Browser
     voices cannot say an isolated consonant.
3. **Keyword** — for sounds no browser voice can produce from text (the short vowels /æ/
   /ɛ/ /ɪ/, /ʊ/ as in book, /aʊ/ as in cow, /ks/, /ɪd/), the app says "the sound at the
   start of apple" instead of inventing a wrong one. These sounds need recordings. Each
   sound lists up to four keywords (`egg elephant elbow`). In a scored question the
   player passes the words on screen (its options and items), and the first keyword
   _not_ shown is used. "Which one starts with /e/?" with egg as a choice says "…the
   start of elephant", never giving the answer away. If every keyword is on screen the
   sound is not spoken.
4. **Nothing** — a token that cannot be resolved is silent, never spoken as letters.

Multi-sound patterns can carry their own rendering (`shun` for TION, `ing` for ING,
`ar` for AR). Otherwise the rendering is built from the phonemes ("kuh suh"). A letter
name comes from `letter_name_say_as`. With no entry, a single capital letter is used,
which every voice reads as its name.

`src/lib/server/sound-table.ts` builds the table (phonemes, multi-sound pattern
renderings, letter names, clip URLs) from the database. The child layout provides it to
every screen (`SoundTableProvider`), and lesson payloads carry their own copy, so lessons
played offline resolve tokens too. Components never know whether a sound comes from a
recording or from synthesis.

## The audio service

`src/lib/audio/audio-service.ts` is the only code that touches `speechSynthesis` or
`Audio` (components call `useAudio().speak` or the `speak` prop):

- **One thing at a time.** Every request (or `stopAudio`) cancels what is playing,
  including the rest of a sequence ("suh… the sound at the start of apple… tuh… sat"),
  so repeated taps never overlap or queue. A sequence reports each item as it starts, so
  the screen can highlight the sound being played.
- **Clean-up.** Leaving a screen (unmount), hiding the app or leaving the page stops the
  sound. A recorded clip that is stopped releases whoever is waiting on it, so the
  `speaking` state never gets stuck.
- **Results.** `played`, `interrupted` (stopped by a newer request: not a failure) or
  `unavailable` (nothing could play: the visible "No sound right now" note).
- **Voice.** en-US, a natural voice when installed (re-chosen when the voice list loads),
  rate 0.85, "Slow" 0.6, pitch 1. The voice is not processed to sound "cute".
- **Recorded clips** play first. If a clip fails, the text is spoken instead.

## Pronunciation matrix

Every pattern sound, before and after this change, as spoken by **espeak-ng** (the engine
behind Chrome and Firefox on Linux). `-x` phoneme output: `'Es` = "ess", `'eItS` =
"aitch", `'V` = the "uh" in _sun_, `'a` = /æ/. Regenerate with the script described in
`docs/development.md` → _Pronunciation audit_.

| Pattern  | Sound (IPA)      | Before: text → espeak-ng                             | After: text → espeak-ng                                                    | Strategy          |
| -------- | ---------------- | ---------------------------------------------------- | -------------------------------------------------------------------------- | ----------------- |
| LETTER_A | A_SHORT /æ/      | `aa` → `'A:`                                         | `the sound at the start of apple` → `D@2 s'aUnd at D@2 st'A@t Vv 'ap@L`    | keyword (keyword) |
| LETTER_A | A_LONG /eɪ/      | `ay` → `'aI`                                         | `eigh` → `'eI`                                                             | tts (pure)        |
| LETTER_B | B /b/            | `buh` → `b'V`                                        | `buh` → `b'V`                                                              | tts (approximate) |
| LETTER_C | C_HARD /k/       | `kuh` → `k'V`                                        | `kuh` → `k'V`                                                              | tts (approximate) |
| LETTER_C | C_SOFT /s/       | `sss` → `,Es,Es'Es`                                  | `suh` → `s'V`                                                              | tts (approximate) |
| LETTER_D | D /d/            | `duh` → `d'V`                                        | `duh` → `d'V`                                                              | tts (approximate) |
| LETTER_E | E_SHORT /ɛ/      | `eh` → `'eI`                                         | `the sound at the start of egg` → `D@2 s'aUnd at D@2 st'A@t Vv 'Eg`        | keyword (keyword) |
| LETTER_E | E_LONG /iː/      | `ee` → `'i:`                                         | `ee` → `'i:`                                                               | tts (pure)        |
| LETTER_F | F /f/            | `fff` → `,Ef,Ef'Ef`                                  | `fuh` → `f'V`                                                              | tts (approximate) |
| LETTER_G | G_HARD /ɡ/       | `guh` → `g'V`                                        | `guh` → `g'V`                                                              | tts (approximate) |
| LETTER_G | G_SOFT /dʒ/      | `juh` → `dZ'V`                                       | `juh` → `dZ'V`                                                             | tts (approximate) |
| LETTER_H | H /h/            | `hh` → `,eItS'eItS`                                  | `huh` → `h'V`                                                              | tts (approximate) |
| LETTER_I | I_SHORT /ɪ/      | `ih` → `'aI`                                         | `the sound at the start of itch` → `D@2 s'aUnd at D@2 st'A@t Vv 'ItS`      | keyword (keyword) |
| LETTER_I | I_LONG /aɪ/      | `eye` → `'aI`                                        | `eye` → `'aI`                                                              | tts (pure)        |
| LETTER_J | J /dʒ/           | `juh` → `dZ'V`                                       | `juh` → `dZ'V`                                                             | tts (approximate) |
| LETTER_K | K /k/            | `kuh` → `k'V`                                        | `kuh` → `k'V`                                                              | tts (approximate) |
| LETTER_L | L /l/            | `lll` → `,El,El'El`                                  | `luh` → `l'V`                                                              | tts (approximate) |
| LETTER_M | M /m/            | `mmm` → `,Em,Em'Em`                                  | `muh` → `m'V`                                                              | tts (approximate) |
| LETTER_N | N /n/            | `nnn` → `,En,En'En`                                  | `nuh` → `n'V`                                                              | tts (approximate) |
| LETTER_O | O_SHORT /ɑ/      | `ah` → `'A:`                                         | `ah` → `'A:`                                                               | tts (pure)        |
| LETTER_O | O_LONG /oʊ/      | `oh` → `'oU`                                         | `oh` → `'oU`                                                               | tts (pure)        |
| LETTER_P | P /p/            | `puh` → `p'V`                                        | `puh` → `p'V`                                                              | tts (approximate) |
| LETTER_Q | Q /kw/           | `kwuh` → `kw'V`                                      | `kwuh` → `kw'V`                                                            | tts (approximate) |
| LETTER_R | R /ɹ/            | `rrr` → `,A@r,A@r'A@`                                | `ruh` → `r'V`                                                              | tts (approximate) |
| LETTER_S | S /s/            | `sss` → `,Es,Es'Es`                                  | `suh` → `s'V`                                                              | tts (approximate) |
| LETTER_S | S_Z /z/          | `zzz` → `z,i:z,i:z'i:`                               | `zuh` → `z'V`                                                              | tts (approximate) |
| LETTER_T | T /t/            | `tuh` → `t'V`                                        | `tuh` → `t'V`                                                              | tts (approximate) |
| LETTER_U | U_SHORT /ʌ/      | `uh` → `'V`                                          | `uh` → `'V`                                                                | tts (pure)        |
| LETTER_U | U_LONG /juː/     | `you` → `j'u:`                                       | `you` → `j'u:`                                                             | tts (pure)        |
| LETTER_V | V /v/            | `vvv` → `v,i:v,i:v'i:`                               | `vuh` → `v'V`                                                              | tts (approximate) |
| LETTER_W | W /w/            | `wuh` → `w'V`                                        | `wuh` → `w'V`                                                              | tts (approximate) |
| LETTER_X | X /ks/           | `ks` → `k,eI'Es`                                     | `the sound at the end of box` → `D@2 s'aUnd at DI2; 'End Vv b'0ks`         | keyword (keyword) |
| LETTER_Y | Y /j/            | `yuh` → `j'V`                                        | `yuh` → `j'V`                                                              | tts (approximate) |
| LETTER_Y | Y_LONG_I /aɪ/    | `eye` → `'aI`                                        | `eye` → `'aI`                                                              | tts (pure)        |
| LETTER_Y | Y_LONG_E /i/     | `ee` → `'i:`                                         | `ee` → `'i:`                                                               | tts (pure)        |
| LETTER_Z | Z /z/            | `zzz` → `z,i:z,i:z'i:`                               | `zuh` → `z'V`                                                              | tts (approximate) |
| SH       | SH /ʃ/           | `shh` → `,Es,eItS'eItS`                              | `shuh` → `S'V`                                                             | tts (approximate) |
| CH       | CH /tʃ/          | `chuh` → `tS'V`                                      | `chuh` → `tS'V`                                                            | tts (approximate) |
| TH       | TH_VOICELESS /θ/ | `th, as in thumb` → `t,i:;'eItS az In T'Vm`          | `thuh` → `T'V`                                                             | tts (approximate) |
| TH       | TH_VOICED /ð/    | `th, as in this` → `t,i:;'eItS az In D'Is`           | `the` → `D'@2`                                                             | tts (approximate) |
| PH       | PH /f/           | `fff` → `,Ef,Ef'Ef`                                  | `fuh` → `f'V`                                                              | tts (approximate) |
| WH       | WH /w/           | `wuh` → `w'V`                                        | `wuh` → `w'V`                                                              | tts (approximate) |
| CK       | CK /k/           | `kuh` → `k'V`                                        | `kuh` → `k'V`                                                              | tts (approximate) |
| NG       | NG /ŋ/           | `ng, as in ring` → `,EndZ'i: az In r'IN`             | `ung` → `'VN`                                                              | tts (approximate) |
| EE       | EE /iː/          | `ee` → `'i:`                                         | `ee` → `'i:`                                                               | tts (pure)        |
| EA       | EA_LONG_E /iː/   | `ee, as in leaf` → `'i: az In l'i:f`                 | `ee` → `'i:`                                                               | tts (pure)        |
| EA       | EA_SHORT_E /ɛ/   | `eh, as in bread` → `'eI az In br'Ed`                | `the sound at the start of egg` → `D@2 s'aUnd at D@2 st'A@t Vv 'Eg`        | keyword (keyword) |
| AI       | AI /eɪ/          | `ay, as in rain` → `'aI az In r'eIn`                 | `eigh` → `'eI`                                                             | tts (pure)        |
| AY       | AY /eɪ/          | `ay, as in play` → `'aI az In pl'eI`                 | `eigh` → `'eI`                                                             | tts (pure)        |
| OA       | OA /oʊ/          | `oh, as in boat` → `'oU az In b'oUt`                 | `oh` → `'oU`                                                               | tts (pure)        |
| OW       | OW_LONG_O /oʊ/   | `oh, as in snow` → `'oU az In sn'oU`                 | `oh` → `'oU`                                                               | tts (pure)        |
| OW       | OW_OU /aʊ/       | `ow, as in cow` → `'oU az In k'aU`                   | `the sound at the start of out` → `D@2 s'aUnd at D@2 st'A@t Vv 'aUt`       | keyword (keyword) |
| OO       | OO_LONG /uː/     | `oo, as in moon` → `'u: az In m'u:n`                 | `ooh` → `'u:`                                                              | tts (pure)        |
| OO       | OO_SHORT /ʊ/     | `oo, as in book` → `'u: az In b'Uk`                  | `the sound in the middle of book` → `D@2 s'aUnd InD@2 m'Id@L Vv b'Uk`      | keyword (keyword) |
| OU       | OU /aʊ/          | `ow, as in out` → `'oU az In 'aUt`                   | `the sound at the start of out` → `D@2 s'aUnd at D@2 st'A@t Vv 'aUt`       | keyword (keyword) |
| OI       | OI /ɔɪ/          | `oy, as in coin` → `'OI az In k'OIn`                 | `oy` → `'OI`                                                               | tts (pure)        |
| OY       | OY /ɔɪ/          | `oy, as in boy` → `'OI az In b'OI`                   | `oy` → `'OI`                                                               | tts (pure)        |
| AR       | AR /ɑɹ/          | `ar, as in car` → `'A@ az In k'A@`                   | `ar` → `'A@`                                                               | tts (pure)        |
| ER       | ER /ɝ/           | `er, as in her` → `'3: az In h'3:`                   | `er` → `'3:`                                                               | tts (pure)        |
| IR       | IR /ɝ/           | `er, as in bird` → `'3: az In b'3:d`                 | `er` → `'3:`                                                               | tts (pure)        |
| OR       | OR /ɔɹ/          | `or, as in fork` → `'O@ az In f'O@k`                 | `or` → `'O@`                                                               | tts (pure)        |
| UR       | UR /ɝ/           | `er, as in nurse` → `'3: az In n'3:s`                | `er` → `'3:`                                                               | tts (pure)        |
| ING      | ING /ɪŋ/         | `ing, as in jumping` → `'IN az In dZ'VmpIN`          | `ing` → `'IN`                                                              | tts (pure)        |
| ED       | ED_T /t/         | `t, as in jumped` → `t'i: az In dZ'Vmpt`             | `tuh` → `t'V`                                                              | tts (approximate) |
| ED       | ED_D /d/         | `d, as in played` → `d'i: az In pl'eId`              | `duh` → `d'V`                                                              | tts (approximate) |
| ED       | ED_ID /ɪd/       | `id, as in painted` → `aId'i: az In p'eIntI#d`       | `the sound at the end of painted` → `D@2 s'aUnd at DI2; 'End Vv p'eIntI#d` | keyword (keyword) |
| ENDING_S | ENDING_S_S /s/   | `sss, as in cats` → `,Es,Es'Es az In k'ats`          | `suh` → `s'V`                                                              | tts (approximate) |
| ENDING_S | ENDING_S_Z /z/   | `zzz, as in dogs` → `z,i:z,i:z'i: az In d'0gz`       | `zuh` → `z'V`                                                              | tts (approximate) |
| ES       | ES /ɪz/          | `iz, as in boxes` → `'Iz az In b'0ksI#z`             | `iz` → `'Iz`                                                               | tts (pure)        |
| TION     | TION /ʃən/       | `shun, as in station` → `S'Vn az In st'eIS@n`        | `shun` → `S'Vn`                                                            | tts (pure)        |
| SION     | SION_ZHUN /ʒən/  | `zhun, as in television` → `Z'Vn az In t'ElI#v,IZ@n` | `zhun` → `Z'Vn`                                                            | tts (pure)        |
| SION     | SION_SHUN /ʃən/  | `shun, as in mansion` → `S'Vn az In m'anS@n`         | `shun` → `S'Vn`                                                            | tts (pure)        |
| MENT     | MENT /mənt/      | `ment, as in payment` → `m'Ent az In p'eIm@nt`       | `ment` → `m'Ent`                                                           | tts (approximate) |
| NESS     | NESS /nəs/       | `ness, as in kindness` → `n'Es az In k'aIndn@s`      | `ness` → `n'Es`                                                            | tts (approximate) |
| FUL      | FUL /fəl/        | `ful, as in helpful` → `f'Vl az In h'Elpf@L`         | `ful` → `f'Vl`                                                             | tts (pure)        |
| LESS     | LESS /ləs/       | `less, as in helpless` → `l'Es az In h'Elpl@s`       | `less` → `l'Es`                                                            | tts (approximate) |
| BL       | BL /bl/          | `bl, as in block` → `b,i:;'El az In bl'0k`           | `bluh` → `bl'V`                                                            | tts (approximate) |
| CL       | CL /kl/          | `cl, as in clap` → `s,i:;'El az In kl'ap`            | `cluh` → `kl'V`                                                            | tts (approximate) |
| FL       | FL /fl/          | `fl, as in flag` → `,Ef'El az In fl'ag`              | `fluh` → `fl'V`                                                            | tts (approximate) |
| FR       | FR /fɹ/          | `fr, as in frog` → `,Ef'A@ az In fr'0g`              | `fruh` → `fr'V`                                                            | tts (approximate) |
| GR       | GR /ɡɹ/          | `gr, as in grin` → `dZ,i:;'A@ az In gr'In`           | `gruh` → `gr'V`                                                            | tts (approximate) |
| TR       | TR /tɹ/          | `tr, as in tree` → `t,i:;'A@ az In tr'i:`            | `truh` → `tr'V`                                                            | tts (approximate) |
| ST       | ST /st/          | `st, as in star` → `s'@nt az In st'A@`               | `stuh` → `st'V`                                                            | tts (approximate) |
| SN       | SN /sn/          | `sn, as in snail` → `,Es'En az In sn'eIl`            | `snuh` → `sn'V`                                                            | tts (approximate) |
| A_E      | A_E /eɪ/         | `ay, as in cake` → `'aI az In k'eIk`                 | `eigh` → `'eI`                                                             | tts (pure)        |
| I_E      | I_E /aɪ/         | `eye, as in kite` → `'aI az In k'aIt`                | `eye` → `'aI`                                                              | tts (pure)        |
| O_E      | O_E /oʊ/         | `oh, as in bone` → `'oU az In b'oUn`                 | `oh` → `'oU`                                                               | tts (pure)        |
| U_E      | U_E /juː/        | `you, as in cube` → `j'u: az In kj'u:b`              | `you` → `j'u:`                                                             | tts (pure)        |
| AIR      | AIR /ɛɹ/         | `air, as in chair` → `'e@ az In tS'e@`               | `air` → `'e@`                                                              | tts (pure)        |

Letter names (A–Z) are spoken from `letter_name_say_as`; all are correct in espeak-ng.
The exception was A: its stored name was `ay`, which espeak-ng reads as "eye", so it is
now `A`.

## Known limitations (browser speech synthesis)

- **Isolated consonants are approximate.** Every consonant is said with a short "uh"
  (`suh`, `buh`). Synthetic-phonics teaching prefers pure sounds (/sss/, a clipped /b/).
  Only recordings can give those.
- **Some sounds have no text rendering at all**: /æ/ (cat), /ɛ/ (bed), /ɪ/ (pig), /ʊ/
  (book), /aʊ/ (cow, out), /ks/ (box), /ɪd/ (painted). The keyword fallback is correct
  but indirect. In blending activities ("tap each sound") these sounds are named by
  keyword, which makes blending by ear much weaker until recordings exist.
- **Engines differ.** The renderings were checked with espeak-ng only. Apple, Google,
  Microsoft and Android voices generally read these tokens the same way, but this has
  not been verified device by device. `the` for /ð/ and `thuh` for /θ/ are the most
  engine-sensitive.
- **Voice quality** depends on the device's installed voices. Without a natural en-US
  voice the speech sounds robotic. This is not a bug.
- The words a dictation step reads are in the browser (speech synthesis needs the text).
  Recordings would remove that.

## Future: professional recordings

Add files to `content-audio` and reference them from content. Nothing in the components
changes:

- a phoneme clip (`phonics.json` → `phonemes[].audio`) — used for every `{/X/}` of that
  sound, everywhere;
- a pattern's sound (`patterns[].audio`) — its main sound;
- a word (`audio` column in the words CSV) — Word Explorer and dictation.

Priority order: the short vowels and /aʊ/ /ʊ/ (no synthesis possible), then all
consonants (pure sounds instead of "suh"), then dictation words.
