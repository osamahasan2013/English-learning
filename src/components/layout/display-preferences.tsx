"use client";

import { useEffect, useState } from "react";

// Per-device display preferences (contrast, text size), applied as attributes on <html>
// that globals.css reacts to. Stored in localStorage: they belong to the device/viewer,
// not to the family account. DISPLAY_PREFERENCES_SCRIPT applies them before first paint.

const KEY = "el:display";
export type DisplayPrefs = { contrast: "normal" | "high"; textSize: "normal" | "large" | "larger" };
const DEFAULTS: DisplayPrefs = { contrast: "normal", textSize: "normal" };

export const DISPLAY_PREFERENCES_SCRIPT = `try{var p=JSON.parse(localStorage.getItem("${KEY}")||"{}");if(p.contrast==="high")document.documentElement.dataset.contrast="high";if(p.textSize&&p.textSize!=="normal")document.documentElement.dataset.textSize=p.textSize}catch(e){}`;

function read(): DisplayPrefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

function apply(prefs: DisplayPrefs) {
  const root = document.documentElement;
  if (prefs.contrast === "high") root.dataset.contrast = "high";
  else delete root.dataset.contrast;
  if (prefs.textSize !== "normal") root.dataset.textSize = prefs.textSize;
  else delete root.dataset.textSize;
}

export function DisplayPreferencesControls() {
  const [prefs, setPrefs] = useState<DisplayPrefs>(DEFAULTS);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
    setPrefs(read());
  }, []);

  function update(next: DisplayPrefs) {
    setPrefs(next);
    apply(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Private mode or blocked storage: the setting still applies for this visit.
    }
  }

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="font-semibold">Text size</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {(["normal", "large", "larger"] as const).map((size) => (
            <label
              key={size}
              className="border-border flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border-2 px-3"
            >
              <input
                type="radio"
                name="text-size"
                checked={prefs.textSize === size}
                onChange={() => update({ ...prefs, textSize: size })}
              />
              <span className="capitalize">{size}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex min-h-11 cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          className="size-5"
          checked={prefs.contrast === "high"}
          onChange={(e) => update({ ...prefs, contrast: e.target.checked ? "high" : "normal" })}
        />
        <span className="font-semibold">High contrast</span>
      </label>
      <p className="text-muted text-sm">
        These settings are saved on this device. Reduced motion follows your device setting.
      </p>
    </div>
  );
}
