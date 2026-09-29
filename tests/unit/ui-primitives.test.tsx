import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Spinner } from "@/components/ui/spinner";
import { SetupRequired } from "@/components/layout/setup-required";

vi.mock("next/navigation", () => ({ usePathname: () => "/parent/children/abc" }));

describe("Button", () => {
  it("is a non-submitting button by default and handles clicks", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("type", "button");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not fire when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Save
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Alert", () => {
  it("announces errors immediately and other messages politely", () => {
    render(
      <>
        <Alert tone="error">Could not save</Alert>
        <Alert tone="success">Saved</Alert>
      </>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save");
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });
});

describe("ProgressBar", () => {
  it("exposes its value to assistive technology and clamps it", () => {
    render(<ProgressBar value={140} max={100} label="Lesson progress" />);
    const bar = screen.getByRole("progressbar", { name: "Lesson progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "140");
    expect(bar.firstElementChild).toHaveStyle({ width: "100%" });
  });
});

describe("EmptyState and Spinner", () => {
  it("renders a title, explanation and action", () => {
    render(
      <EmptyState icon="📘" title="No lessons yet" action={<button type="button">Start</button>}>
        Lessons appear here.
      </EmptyState>,
    );
    expect(screen.getByText("No lessons yet")).toBeInTheDocument();
    expect(screen.getByText("Lessons appear here.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  it("labels the spinner", () => {
    render(<Spinner label="Loading content" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading content");
  });
});

describe("SetupRequired", () => {
  it("lists missing setting names", () => {
    render(<SetupRequired problems={["NEXT_PUBLIC_SUPABASE_URL is required"]} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/not set up yet/);
    expect(screen.getByText("NEXT_PUBLIC_SUPABASE_URL is required")).toBeInTheDocument();
  });
});

describe("AppShell navigation", () => {
  it("marks the current section and provides a main landmark", async () => {
    const { AppShell } = await import("@/components/layout/app-shell");
    render(
      <AppShell
        brandHref="/parent/dashboard"
        brand="Brand"
        navLabel="Parent"
        nav={[
          { href: "/parent/dashboard", label: "Dashboard" },
          { href: "/parent/children", label: "Children" },
        ]}
      >
        <p>Content</p>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "Children" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
  });
});
