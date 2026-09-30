import type { MetadataRoute } from "next";
import { APP_NAME, APP_SHORT_NAME } from "@/lib/app-info";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_SHORT_NAME,
    description: "Phonics, reading, vocabulary and spelling for children from KG1 to Grade 2.",
    // Opens in the child area when the device is in child mode (and offline, from the
    // cached page); otherwise requireActiveChild sends a parent on to the dashboard.
    start_url: "/child/home",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#fffaf2",
    theme_color: "#1d4ed8",
    categories: ["education", "kids"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
