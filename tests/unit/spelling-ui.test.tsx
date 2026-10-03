import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChildKeyboard } from "@/components/child/child-keyboard";
import { SpellingInput } from "@/features/activities/renderers/spelling-input";
import { DictationControls } from "@/features/activities/renderers/dictation-controls";
import { useState } from "react";

// The spelling input methods: device keyboard, the child on-screen keyboard, letter tiles
// (tap) and the dictation replay limit. The answer is always the text the child wrote.

function Keyboard({ onSubmit, sentence = false }: { onSubmit: (v: string) => void; sentence?: boolean }) {
  const [value, setValue] = useState("");
  return (
    <ChildKeyboard value={value} onChange={setValue} onSubmit={() => onSubmit(value)} sentence={sentence} />
  );
}

describe("ChildKeyboard", () => {
  it("types with big buttons, deletes, and submits only something written", async () => {
    const onSubmit = vi.fn();
    render(<Keyboard onSubmit={onSubmit} />);
    const keys = screen.getByRole("group", { name: "Keyboard" });
    const check = within(keys).getByRole("button", { name: /Check/ });
    expect(check).toBeDisabled();
    for (const key of ["s", "h", "i", "p", "p"])
      await userEvent.click(within(keys).getByRole("button", { name: key }));
    await userEvent.click(within(keys).getByRole("button", { name: /Delete/ }));
    expect(screen.getByLabelText("Your spelling: s h i p")).toBeInTheDocument();
    await userEvent.click(check);
    expect(onSubmit).toHaveBeenCalledWith("ship");
  });

  it("uses plain buttons only, so a tap cannot submit a form or navigate", () => {
    render(<Keyboard onSubmit={() => {}} />);
    for (const button of screen.getAllByRole("button")) expect(button).toHaveAttribute("type", "button");
    expect(document.querySelector("form")).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("accepts a physical keyboard; Backspace does not go back", async () => {
    const onSubmit = vi.fn();
    render(<Keyboard onSubmit={onSubmit} />);
    await userEvent.keyboard("Cat{Backspace}t{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("cat");
  });

  it("has space, a capital key and full stops for sentences", async () => {
    const onSubmit = vi.fn();
    render(<Keyboard onSubmit={onSubmit} sentence />);
    const keys = screen.getByRole("group", { name: "Keyboard" });
    await userEvent.click(within(keys).getByRole("button", { name: "Capital letter next" }));
    for (const key of ["i", "space", "r", "u", "n", "full stop"])
      await userEvent.click(within(keys).getByRole("button", { name: key }));
    await userEvent.click(within(keys).getByRole("button", { name: /Check/ }));
    expect(onSubmit).toHaveBeenCalledWith("I run.");
  });
});

describe("SpellingInput", () => {
  it("uses the device keyboard without autocorrect and keeps the text as typed", async () => {
    const onSubmit = vi.fn();
    render(
      <SpellingInput id="q" method="KEYBOARD" slots={4} locked={false} state="none" onSubmit={onSubmit} />,
    );
    const field = screen.getByLabelText("Type the word");
    expect(field).toHaveAttribute("autocorrect", "off");
    expect(field).toHaveAttribute("spellcheck", "false");
    await userEvent.type(field, " Sip ");
    await userEvent.click(screen.getByRole("button", { name: /Check/ }));
    expect(onSubmit).toHaveBeenCalledWith(" Sip ");
  });

  it("builds the word from letter tiles", async () => {
    const onSubmit = vi.fn();
    render(
      <SpellingInput
        id="q"
        method="LETTER_TILES"
        tiles={["p", "s", "x", "i", "h"]}
        slots={4}
        locked={false}
        state="none"
        onSubmit={onSubmit}
      />,
    );
    const tiles = screen.getByRole("group", { name: "Tiles" });
    for (const t of ["s", "h", "i", "p"])
      await userEvent.click(within(tiles).getByRole("button", { name: t }));
    await userEvent.click(screen.getByRole("button", { name: /Check/ }));
    expect(onSubmit).toHaveBeenCalledWith("ship");
  });

  it("falls back to the child keyboard when tiles are asked for but the question has none", () => {
    render(
      <SpellingInput id="q" method="DRAG_DROP" slots={3} locked={false} state="none" onSubmit={() => {}} />,
    );
    expect(screen.getByRole("group", { name: "Keyboard" })).toBeInTheDocument();
  });

  it("is locked while feedback shows", () => {
    render(
      <SpellingInput id="q" method="ON_SCREEN_KEYBOARD" slots={3} locked state="wrong" onSubmit={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "a" })).toBeDisabled();
  });
});

describe("DictationControls", () => {
  it("counts listens down to the limit, with a slow button", async () => {
    const speak = vi.fn().mockResolvedValue(true);
    render(<DictationControls text="ship" speak={speak} limit={3} slow alreadyPlayed={1} />);
    expect(screen.getByText(/2 listens left/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Slow/ }));
    expect(speak).toHaveBeenCalledWith("ship", "slow");
    await userEvent.click(screen.getByRole("button", { name: /Listen/ }));
    expect(screen.getByText(/No more listens/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Listen/ })).toBeDisabled();
  });

  it("can be unlimited", () => {
    render(<DictationControls text="ship" speak={vi.fn()} limit={null} slow={false} />);
    expect(screen.queryByText(/left/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Slow/ })).toBeNull();
  });
});
