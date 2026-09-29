import { redirect } from "next/navigation";

export default function ChildIndex() {
  redirect("/child/home");
}
