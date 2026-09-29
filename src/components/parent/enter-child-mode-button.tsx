import { enterChildMode } from "@/app/parent/child-actions";
import { Button, type ButtonProps } from "@/components/ui/button";

export function EnterChildModeButton({
  childId,
  name,
  size = "lg",
}: {
  childId: string;
  name: string;
  size?: ButtonProps["size"];
}) {
  return (
    <form action={enterChildMode.bind(null, childId)}>
      <Button type="submit" size={size} variant="success">
        ▶ Start learning{size === "lg" ? ` as ${name}` : ""}
      </Button>
    </form>
  );
}
