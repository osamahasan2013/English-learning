import { redirect } from "next/navigation";

export default function ParentIndex() {
  redirect("/parent/dashboard");
}
