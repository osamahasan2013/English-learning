import type { PhonicsFile } from "@/lib/content/content-schemas";

// Phonics content rules. Errors make the import fail for that item; warnings are
// questionable content (an example word without its pattern, an unusual split) that is
// imported but flagged for an admin to review — pronunciation is never "auto-corrected".

export type ValidationIssue = { entity: "phonics_pattern" | "word" | "question"; key: string; rule: string; message: string };

export type PhonicsValidation = { errors: ValidationIssue[]; warnings: ValidationIssue[] };

export function validatePhonicsFile(file: PhonicsFile, levelCodes: ReadonlySet<string>): PhonicsValidation {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const err = (key: string, rule: string, message: string) =>
    errors.push({ entity: "phonics_pattern", key, rule, message });
  const warn = (key: string, rule: string, message: string) =>
    warnings.push({ entity: "phonics_pattern", key, rule, message });

  const phonemes = new Set<string>();
  for (const ph of file.phonemes) {
    if (phonemes.has(ph.code)) err(ph.code, "duplicate_phoneme", `phoneme ${ph.code} is defined twice`);
    phonemes.add(ph.code);
  }
  const stages = new Set(file.stages.map((s) => s.code));
  const codes = new Set<string>();
  const byText = new Map<string, string[]>();

  for (const p of file.patterns) {
    if (codes.has(p.code)) err(p.code, "duplicate_pattern", `pattern ${p.code} is defined twice`);
    codes.add(p.code);
    if (!p.pattern.trim()) err(p.code, "empty_pattern", "the pattern is empty");
    const textKey = `${p.type}:${p.pattern}`;
    byText.set(textKey, [...(byText.get(textKey) ?? []), p.code]);
    if (!levelCodes.has(p.level)) err(p.code, "unknown_level", `level ${p.level} does not exist`);
    if (p.stage && !stages.has(p.stage)) err(p.code, "unknown_stage", `stage ${p.stage} does not exist`);
    if (p.type === "letter") {
      if (!p.uppercase) err(p.code, "letter_uppercase", "a letter needs its uppercase form");
      if (!p.letterName) err(p.code, "letter_name", "a letter needs its name (kept apart from its sound)");
      // The voice reads a letter's name from the capital letter (pronunciation.ts); the
      // stored rendering must say the same, so data and speech can never disagree.
      if (p.letterNameSayAs && p.letterNameSayAs !== p.pattern.toUpperCase())
        err(p.code, "letter_name_say_as", `a letter's spoken name is its capital (${p.pattern.toUpperCase()}), not "${p.letterNameSayAs}"`);
      if (p.pattern.length !== 1) err(p.code, "letter_length", "a letter pattern is one letter");
    }
    if (p.pattern.includes("_") && p.type !== "silent_e") err(p.code, "split_type", "only silent_e patterns may be split (a_e)");
    for (const s of p.sounds) {
      if (s.phonemes.length === 0) err(p.code, "sound_without_phonemes", `${s.code} has no phonemes`);
      for (const code of s.phonemes)
        if (phonemes.size > 0 && !phonemes.has(code))
          err(p.code, "unknown_phoneme", `${s.code} uses unknown phoneme ${code}`);
    }
    const soundCodes = new Set(p.sounds.map((s) => s.code));
    if (soundCodes.size !== p.sounds.length) err(p.code, "duplicate_sound", "sound codes must be unique");
  }
  for (const p of file.patterns) {
    for (const r of p.relations) {
      if (r.code === p.code) err(p.code, "self_relation", "a pattern cannot relate to itself");
      else if (!codes.has(r.code)) err(p.code, "unknown_relation", `related pattern ${r.code} does not exist`);
    }
  }
  for (const [key, list] of byText) {
    if (list.length > 1)
      warn(list[0], "duplicate_pattern_text", `${list.join(", ")} share the spelling "${key.split(":")[1]}" and type`);
  }
  return { errors, warnings };
}
