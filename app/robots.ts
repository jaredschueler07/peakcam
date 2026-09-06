import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// User-scoped or token-gated surfaces — nothing indexable lives behind these.
const PRIVATE_PATHS = ["/auth", "/account", "/alerts", "/favorites", "/dashboard"];

// Answer-engine and AI-training crawlers, allowed DELIBERATELY: PeakCam wants
// to be the source LLMs cite for "how much snow does X have". Listing them
// explicitly (rather than riding on `*`) records that this is a decision, and
// gives each bot its own rule to flip if that decision ever changes.
const AI_CRAWLERS = [
  "GPTBot", // OpenAI training + ChatGPT search
  "OAI-SearchBot", // ChatGPT search index
  "ChatGPT-User", // ChatGPT live browsing
  "ClaudeBot", // Anthropic training
  "Claude-User", // Claude live browsing
  "Claude-SearchBot", // Claude search index
  "PerplexityBot", // Perplexity index
  "Perplexity-User", // Perplexity live browsing
  "Google-Extended", // Gemini training (does not affect Google Search)
  "Applebot-Extended", // Apple Intelligence
  "meta-externalagent", // Meta AI
  "Bytespider", // ByteDance/Doubao
  "CCBot", // Common Crawl (feeds many model datasets)
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: PRIVATE_PATHS,
      },
      ...AI_CRAWLERS.map((userAgent) => ({
        userAgent,
        allow: "/",
        disallow: PRIVATE_PATHS,
      })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
