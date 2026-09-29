"use client";

import { useCallback, useEffect, useState } from "react";
import {
  isSpeechSynthesisAvailable,
  playAudio,
  stopAudio,
  type AudioRequest,
} from "@/lib/audio/audio-service";

export function useAudio() {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser capability is only known after mount
    setSupported(isSpeechSynthesisAvailable());
    // Voices load asynchronously in some browsers; touching the list starts loading.
    if (isSpeechSynthesisAvailable()) window.speechSynthesis.getVoices();
    return () => stopAudio();
  }, []);

  const speak = useCallback(async (request: AudioRequest) => {
    setSpeaking(true);
    try {
      return await playAudio(request);
    } finally {
      setSpeaking(false);
    }
  }, []);

  return { speak, speaking, supported };
}
