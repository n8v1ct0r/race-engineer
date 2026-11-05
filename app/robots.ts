import type { MetadataRoute } from "next";

// Every page may be crawled; the notes route is an action, not a page.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: "/api/" } };
}
