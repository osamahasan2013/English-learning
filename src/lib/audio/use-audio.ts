"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  isSpeechSynthesisAvailable,
  playAudio,
  stopAudio,
  type AudioRequest,
  type PlayOptions,
  type PlayResult,
} from "@/lib/audio/audio-service";
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

export function useAudio(table?: SoundTable) {
  const contextTable = useSoundTable();
  const sounds = table ?? contextTable;
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser capability is only known after mount
    setSupported(isSpeechSynthesisAvailable());
    // Voices load asynchronously in some browsers; touching the list starts loading.
    if (isSpeechSynthesisAvailable()) window.speechSynthesis.getVoices();
    // Leaving the screen stops whatever is playing (and any sequence in progress).
    return () => {
      mounted.current = false;
      stopAudio();
    };
  }, []);

  const speak = useCallback(
    async (
      request: AudioRequest | AudioRequest[],
      options: Omit<PlayOptions, "sounds"> = {},
    ): Promise<PlayResult> => {
      setSpeaking(true);
      try {
        return await playAudio(request, { ...options, sounds });
      } finally {
        if (mounted.current) setSpeaking(false);
      }
    },
    [sounds],
  );

  return { speak, speaking, supported, stop: stopAudio };
}
