import { describe, expect, it } from "vitest";
import { pickVoice, playAudio } from "@/lib/audio/audio-service";

const voice = (name: string, lang: string, localService = true) =>
  ({ name, lang, localService }) as SpeechSynthesisVoice;

describe("pickVoice", () => {
  it("prefers a natural American English voice", () => {
    const voices = [voice("Daniel", "en-GB"), voice("Fred", "en-US"), voice("Samantha", "en-US")];
    expect(pickVoice(voices)?.name).toBe("Samantha");
  });

  it("falls back to any English voice when no American voice exists", () => {
    expect(pickVoice([voice("Amélie", "fr-FR"), voice("Daniel", "en-GB")])?.name).toBe("Daniel");
  });

  it("returns null when there are no usable voices", () => {
    expect(pickVoice([voice("Amélie", "fr-FR")])).toBeNull();
  });
});

describe("playAudio", () => {
  it("never throws when the browser has no speech synthesis", async () => {
    // jsdom has no speechSynthesis.
    await expect(playAudio({ text: "cat" })).resolves.toBe(false);
  });
});
