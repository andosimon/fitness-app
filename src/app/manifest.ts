import type { MetadataRoute } from "next";

/**
 * Web app manifest, served at /manifest.webmanifest.
 *
 * `display: standalone` is what makes an installed copy open without browser
 * chrome, which matters when you're using it one-handed between sets.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fitness Tracker",
    short_name: "Fitness",
    description: "Strength, conditioning and cardio programming with a built-in coach.",
    start_url: "/",
    display: "standalone",
    // Portrait only: this is a phone app used while standing over a barbell.
    orientation: "portrait",
    background_color: "#0b0d10",
    theme_color: "#0b0d10",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Android crops maskable icons to arbitrary shapes, so this variant keeps
      // the barbell inside the safe zone.
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
