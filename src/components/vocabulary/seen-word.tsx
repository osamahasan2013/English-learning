"use client";

import { useEffect } from "react";
import { noteWordSeen } from "@/app/child/words/actions";

// Records that the child opened this word (My Words "first seen"), once per visit.
export function SeenWord({ wordId }: { wordId: string }) {
  useEffect(() => {
    void noteWordSeen(wordId).catch(() => {});
  }, [wordId]);
  return null;
}
