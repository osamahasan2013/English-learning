import { Spinner } from "@/components/ui/spinner";

export default function Loading() {
  return (
    <div className="flex justify-center py-16">
      <Spinner label="Loading content" />
    </div>
  );
}
