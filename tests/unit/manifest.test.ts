import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

describe("web app manifest", () => {
  const m = manifest();

  it("is installable as a standalone app", () => {
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBeTruthy();
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
  });

  it("has 192px, 512px and maskable icons that exist on disk", () => {
    const icons = m.icons ?? [];
    expect(icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(icons.some((i) => i.purpose === "maskable")).toBe(true);
    for (const icon of icons) {
      expect(existsSync(path.resolve(__dirname, "../../public", icon.src.replace(/^\//, ""))), icon.src).toBe(
        true,
      );
    }
  });
});
