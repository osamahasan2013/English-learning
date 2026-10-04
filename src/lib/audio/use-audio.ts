"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  getAudioSnapshot,
  getServerAudioSnapshot,
  isSpeechSynthesisAvailable,
  playAudio,
  prepareAudio,
  stopAudio,
  subscribeAudio,
  type AudioOwner,
  type AudioRequest,
  type PlaybackState,
  type PlayOptions,
  type PlayResult,
} from "@/lib/audio/audio-service";
import { DEFAULT_AUDIO_PACING, type AudioPacing } from "@/lib/audio/pacing";
import { EMPTY_SOUND_TABLE, type SoundTable } from "@/lib/audio/pronunciation";

// The phonics sounds and letter names for the screen (from the database, with any
// recorded clips). The child layout provides it; a lesson provides its own copy so it
// also works offline.
const SoundTableContext = createContext<SoundTable>(EMPTY_SOUND_TABLE);

export function SoundTableProvider({ table, children }: { table: SoundTable; children: ReactNode }) {
  return createElement(SoundTableContext.Provider, { value: table }, children);
}

export function useSoundTable() {
  return useContext(SoundTableContext);
}

// How fast and in what pieces speech is read for the child's level (the `audio` learning
// rules). The child layout provides it for the child's level; a lesson provides its own.
const AudioPacingContext = createContext<AudioPacing>(DEFAULT_AUDIO_PACING);

export function AudioPacingProvider({ pacing, children }: { pacing: AudioPacing; children: ReactNode }) {
  return createElement(AudioPacingContext.Provider, { value: pacing }, children);
}

export function useAudioPacing() {
  return useContext(AudioPacingContext);
}

// The playback state as the service knows it (one store for the whole app).
export function useAudioSnapshot() {
  return useSyncExternalStore(subscribeAudio, getAudioSnapshot, getServerAudioSnapshot);
}

// A screen's access to audio. The screen is the owner of what it starts: `speaking` and
// `state` describe its own request (derived from the service, never kept separately), and
// leaving the screen stops its sound — not a sound another screen started meanwhile.
export function useAudio(table?: SoundTable, pacing?: AudioPacing) {
  const contextTable = useSoundTable();
  const sounds = table ?? contextTable;
  const contextPacing = useAudioPacing();
  const pace = pacing ?? contextPacing;
  const [owner] = useState<AudioOwner>(() => ({}));
  const [supported, setSupported] = useState(true);
  const snapshot = useAudioSnapshot();
  const mine = snapshot.owner === owner;
  const state: PlaybackState = mine ? snapshot.state : "idle";

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser capability is only known after mount
    setSupported(isSpeechSynthesisAvailable());
    // Voices load asynchronously in some browsers; touching the list starts loading.
    prepareAudio();
    return () => stopAudio({ owner });
  }, [owner]);

  const speak = useCallback(
    (
      request: AudioRequest | AudioRequest[],
      options: Omit<PlayOptions, "sounds" | "owner" | "pacing"> = {},
    ): Promise<PlayResult> => playAudio(request, { ...options, sounds, owner, pacing: pace }),
    [sounds, owner, pace],
  );

  const stop = useCallback(() => stopAudio({ owner }), [owner]);

  return { speak, speaking: state === "loading" || state === "playing", state, supported, stop };
}
