import type { MetadataRoute } from "next";
import {
  getChangelogPageHref,
  getChangelogTotalPages,
  type ChangelogMode,
} from "./changelog/pagination";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://freed.wtf";

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${baseUrl}/manifesto`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/vision`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/roadmap`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/changelog`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/changelog/prod`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  const changelogPages: MetadataRoute.Sitemap = (
    ["all", "production"] satisfies ChangelogMode[]
  ).flatMap((mode) =>
    Array.from(
      { length: Math.max(0, getChangelogTotalPages(mode) - 1) },
      (_, index) => ({
        url: `${baseUrl}${getChangelogPageHref(index + 2, mode)}`,
        lastModified: new Date(),
        changeFrequency: "weekly" as const,
        priority: 0.7,
      }),
    ),
  );

  return [...staticPages, ...changelogPages];
}
