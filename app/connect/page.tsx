import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { PeakFooter } from "@/components/home/PeakFooter";
import { HubBreadcrumb } from "@/components/hubs/HubBreadcrumb";
import { ClientCard } from "@/components/connect/ClientCard";
import { CodeBlock } from "@/components/connect/CodeBlock";
import { ToolTable } from "@/components/connect/ToolTable";
import {
  absolute,
  CLAUDE_CODE_COMMAND,
  CLAUDE_CONNECTOR_LINK,
  CONNECT_LINKS,
  CONNECT_TOOLS,
  CONNECT_URL,
  CURSOR_MCP_JSON,
  EXAMPLE_PROMPTS,
  EXTERNAL_LINKS,
  HERMES_WEBHOOK_COMMAND,
  MCP_ENDPOINT,
  MCP_NAME,
  WEBHOOK_SAMPLE,
} from "@/components/connect/links";
import { SITE_URL } from "@/lib/site";

// /connect — "Use PeakCam with your AI assistant". Static, server-rendered,
// no client state: every recipe is plain text an assistant or a person can
// lift. Links come from components/connect/links.ts so the route check in
// tests/connect-links.test.ts covers exactly what renders here.
export const dynamic = "force-static";

const TITLE = "Use PeakCam with your AI assistant";
const DESCRIPTION =
  "Connect Claude, ChatGPT, Cursor, Grok, Perplexity or your own agent to PeakCam's MCP server for live snow reports, " +
  "SNOTEL measurements, webcams and powder rankings across 150 ski resorts. No key, read-only, plus an answer endpoint, REST, OpenAPI, markdown and Atom alternatives.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: CONNECT_URL },
  keywords: ["PeakCam MCP", "ski resort MCP server", "snow report API", "Claude connector ski conditions", "SNOTEL API"],
  openGraph: { title: TITLE, description: DESCRIPTION, url: CONNECT_URL, type: "website", siteName: "PeakCam" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const COUNT_WORDS: Record<number, string> = { 8: "Eight", 10: "Ten", 12: "Twelve", 14: "Fourteen", 15: "Fifteen", 16: "Sixteen" };

const linkClass = "font-bold text-ink underline decoration-alpen/60 decoration-2 underline-offset-[3px] hover:decoration-alpen";
const chipClass =
  "rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 font-bold text-ink shadow-stamp-sm hover:bg-cream";

function SectionHeading({ id, eyebrow, children }: { id: string; eyebrow: string; children: string }) {
  return (
    <>
      <p className="pc-eyebrow mb-2">{eyebrow}</p>
      <h2 id={id} className="font-display text-2xl font-black tracking-[-0.01em] text-ink md:text-3xl">
        {children}
      </h2>
    </>
  );
}

function UrlRow({ href, label, note }: { href: string; label: string; note: string }) {
  return (
    <li className="flex flex-col gap-1 border-b-[1.5px] border-dashed border-bark/50 py-3 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-4">
      <span className="shrink-0 text-[15px] font-bold text-ink sm:w-56">{label}</span>
      <span className="min-w-0 flex-1">
        <a href={href} className="break-all font-mono text-[13px] text-ink underline decoration-alpen/60 underline-offset-[3px] hover:decoration-alpen">
          {SITE_URL}
          {href}
        </a>
        <span className="block text-sm text-bark">{note}</span>
      </span>
    </li>
  );
}

export default function ConnectPage() {
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Connect", item: CONNECT_URL },
    ],
  };
  const webPageLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    url: CONNECT_URL,
    name: TITLE,
    description: DESCRIPTION,
    isPartOf: { "@type": "WebSite", name: "PeakCam", url: SITE_URL },
    about: {
      "@type": "SoftwareApplication",
      name: "PeakCam Snow MCP server",
      alternateName: MCP_NAME,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Any",
      url: MCP_ENDPOINT,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageLd) }} />
      <Header showSearch={false} />
      <main id="main-content" className="mx-auto max-w-4xl px-4 py-10 sm:px-5 md:py-12">
        <HubBreadcrumb items={[{ label: "Home", href: CONNECT_LINKS.home.href }, { label: "Connect" }]} />

        <p className="pc-eyebrow mb-3 mt-6">MCP server · REST API · feeds · no key</p>
        <h1 className="font-display text-4xl font-black leading-[0.95] tracking-[-0.02em] text-ink md:text-5xl [overflow-wrap:anywhere]">
          Use PeakCam with your AI assistant
        </h1>
        <p className="mt-5 max-w-2xl text-balance text-lg leading-snug text-bark-dk">
          One URL gives Claude, ChatGPT, Cursor or your own agent the same data as this site: the latest measured snow at
          every resort, webcams as links, forecasts and season dates. Read-only, anonymous, free.
        </p>
        <CodeBlock label="MCP endpoint">{MCP_ENDPOINT}</CodeBlock>
        <nav aria-label="On this page" className="mt-5 flex flex-wrap gap-2 text-sm">
          <a href="#tools" className={chipClass}>What you get</a>
          <a href="#clients" className={chipClass}>Set it up</a>
          <a href="#prompts" className={chipClass}>Example prompts</a>
          <a href="#data" className={chipClass}>Data and attribution</a>
          <a href="#without-mcp" className={chipClass}>Without MCP</a>
        </nav>

        {/* 1. What you get */}
        <section aria-labelledby="tools" className="mt-14 scroll-mt-20">
          <SectionHeading id="tools" eyebrow="1 · What you get">
            {`${COUNT_WORDS[CONNECT_TOOLS.length] ?? CONNECT_TOOLS.length} tools, one resource`}
          </SectionHeading>
          <p className="mt-4 max-w-3xl text-[15.5px] leading-relaxed text-ink">
            The server is <span className="font-mono text-[14px]">{MCP_NAME}</span>, speaking stateless Streamable HTTP with no
            authentication and no legacy SSE endpoint; it negotiates protocol revisions 2026-07-28, 2025-11-25 and
            2025-06-18, and a plain browser GET on the URL returns a small JSON description of itself. Every tool is
            annotated read-only and returns a short, dated markdown answer plus a structured document that matches the{" "}
            <a href={CONNECT_LINKS.openapi.href} className={linkClass}>
              public API
            </a>{" "}
            wire types. Each snow number carries its source and time, so the assistant can say &ldquo;6 in in 24 h,
            SNOTEL-measured, 05:00 MST&rdquo; instead of a bare figure.
          </p>
          <ToolTable />
        </section>

        {/* 2. Per-client steps */}
        <section aria-labelledby="clients" className="mt-14 scroll-mt-20">
          <SectionHeading id="clients" eyebrow="2 · Set it up">
            Pick your client
          </SectionHeading>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <ClientCard id="claude" title="Claude.ai and Claude Desktop">
              <p>Paid plans can add a custom connector. The link below opens the dialog with the name and URL filled in.</p>
              <a
                href={CLAUDE_CONNECTOR_LINK}
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center rounded-full border-[1.5px] border-ink bg-ink px-5 py-2 font-bold text-cream-50 shadow-stamp-sm hover:bg-forest"
              >
                Add PeakCam to Claude
              </a>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-ink/90">
                <li>Or: Settings → Connectors → Add custom connector.</li>
                <li>Name <span className="font-mono text-[13px]">PeakCam</span>, URL the endpoint above, no OAuth.</li>
                <li>Enable it in a chat under the tools menu and ask about a resort.</li>
              </ol>
            </ClientCard>

            <ClientCard id="claude-code" title="Claude Code">
              <p>One command registers the server for the current project, or add <span className="font-mono text-[13px]">--scope user</span> for everywhere.</p>
              <CodeBlock label="Claude Code command">{CLAUDE_CODE_COMMAND}</CodeBlock>
              <p className="text-sm text-ink/90">Check with <span className="font-mono text-[13px]">claude mcp list</span>; the tools appear as <span className="font-mono text-[13px]">mcp__peakcam__*</span>.</p>
            </ClientCard>

            <ClientCard id="chatgpt" title="ChatGPT (developer mode)">
              <ol className="list-decimal space-y-1 pl-5">
                <li>Settings → Apps &amp; Connectors → Advanced → turn on Developer mode.</li>
                <li>Back in Apps &amp; Connectors, choose Create.</li>
                <li>Name <span className="font-mono text-[13px]">PeakCam</span>, MCP server URL the endpoint above, Authentication: No authentication.</li>
                <li>Start a chat with the connector enabled under the plus menu.</li>
              </ol>
              <p className="text-sm text-bark">Developer mode is available on Plus, Pro, Business and Enterprise plans; an admin may need to enable it for a workspace.</p>
            </ClientCard>

            <ClientCard id="cursor" title="Cursor">
              <p>Add the server to <span className="font-mono text-[13px]">.cursor/mcp.json</span> in a project, or to <span className="font-mono text-[13px]">~/.cursor/mcp.json</span> for every project.</p>
              <CodeBlock label="Cursor mcp.json">{CURSOR_MCP_JSON}</CodeBlock>
              <p className="text-sm text-ink/90">The same object works in Windsurf, Zed, VS Code and any client that reads an <span className="font-mono text-[13px]">mcpServers</span> map with a <span className="font-mono text-[13px]">url</span> entry.</p>
            </ClientCard>

            <ClientCard id="grok-perplexity" title="Grok and Perplexity" badge="Where supported">
              <p>
                Both expose a custom connector field on some plans: paste the endpoint as the server URL and leave
                authentication empty. Where the field is missing, the{" "}
                <a href="#without-mcp" className={linkClass}>
                  markdown and REST alternates
                </a>{" "}
                below work as plain web fetches.
              </p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink/90">
                <li>Grok: Settings → Connectors → Add custom connector → MCP server URL.</li>
                <li>Perplexity: Settings → Connectors → Add connector → Advanced → Server URL.</li>
              </ul>
            </ClientCard>

            <ClientCard id="agents" title="Hermes and self-hosted agents" badge="Push, not pull">
              <p>
                An agent that should wake up when it snows does not need MCP. Register a webhook on{" "}
                <Link href={CONNECT_LINKS.alertsManage.href} prefetch={false} className={linkClass}>
                  {CONNECT_LINKS.alertsManage.label.toLowerCase()}
                </Link>
                : each powder alert is POSTed as JSON, signed per{" "}
                <a href={EXTERNAL_LINKS.standardWebhooks} rel="noopener noreferrer" className={linkClass}>
                  Standard Webhooks
                </a>{" "}
                (<span className="font-mono text-[13px]">webhook-id</span>, <span className="font-mono text-[13px]">webhook-timestamp</span>,{" "}
                <span className="font-mono text-[13px]">webhook-signature</span>; the secret shown once starts with{" "}
                <span className="font-mono text-[13px]">whsec_</span>).
              </p>
              <CodeBlock label="Hermes webhook subscription">{HERMES_WEBHOOK_COMMAND}</CodeBlock>
              <p className="text-sm text-ink/90">Hermes prints the URL it listens on; paste it into the webhook field. The payload:</p>
              <CodeBlock label="Webhook payload">{WEBHOOK_SAMPLE}</CodeBlock>
              <p className="text-sm text-ink/90">
                For agents that poll instead (a Grok routine, a cron job), read the per-resort Atom feed below; no token
                needed. Receivers wanting exactly-once should key on <span className="font-mono text-[13px]">resort.slug + measuredAt</span>.
              </p>
            </ClientCard>
          </div>
        </section>

        {/* 3. Example prompts */}
        <section aria-labelledby="prompts" className="mt-14 scroll-mt-20">
          <SectionHeading id="prompts" eyebrow="3 · Try it">
            {`${COUNT_WORDS[EXAMPLE_PROMPTS.length] ?? EXAMPLE_PROMPTS.length} prompts that work`}
          </SectionHeading>
          <ol className="mt-5 grid gap-3 sm:grid-cols-2">
            {EXAMPLE_PROMPTS.map((item, index) => (
              <li
                key={item.prompt}
                className="rounded-[18px] border-[1.5px] border-ink bg-cream-50 px-5 py-4 shadow-stamp-sm"
              >
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-bark">Prompt {index + 1}</span>
                <p className="mt-1 text-[15.5px] font-bold leading-snug text-ink">&ldquo;{item.prompt}&rdquo;</p>
                <p className="mt-2 font-mono text-[12px] text-bark">{item.tools}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* 4. Data and attribution */}
        <section aria-labelledby="data" className="mt-14 scroll-mt-20 max-w-3xl">
          <SectionHeading id="data" eyebrow="4 · Provenance">
            Where the data comes from
          </SectionHeading>
          <div className="mt-4 space-y-4 text-[15.5px] leading-relaxed text-ink">
            <p>
              Where a resort has an assigned NRCS{" "}
              <Link href={CONNECT_LINKS.snotel.href} prefetch={false} className={linkClass}>
                SNOTEL or SCAN station
              </Link>{" "}
              (most of the western United States), snow numbers are that station&rsquo;s telemetry, quality-controlled and
              synced every six hours. Resorts without one (Canada, most of the East, the Andes) carry{" "}
              <a href={EXTERNAL_LINKS.openMeteo} rel="noopener noreferrer" className={linkClass}>
                Open-Meteo
              </a>{" "}
              model estimates and say so in every response. Forecasts are the National Weather Service for US resorts.
              Webcams belong to their operators; PeakCam links to them and reports whether the last probe found them live.
              Season dates come from the resort when confirmed and from third-party projections otherwise. The{" "}
              <Link href={CONNECT_LINKS.methodology.href} prefetch={false} className={linkClass}>
                methodology page
              </Link>{" "}
              has the quality-control rules and the{" "}
              <Link href={CONNECT_LINKS.freshness.href} prefetch={false} className={linkClass}>
                freshness
              </Link>{" "}
              guarantees.
            </p>
            <h3 className="font-display text-xl font-black tracking-[-0.01em] text-ink">Attribution policy</h3>
            <ul className="list-disc space-y-2 pl-5">
              <li>Quote any number with a link to the resort&rsquo;s PeakCam page (the <span className="font-mono text-[13px]">canonicalUrl</span> in every response).</li>
              <li>SNOTEL numbers are USDA NRCS measurements; say so when it matters, and note the station sits at one elevation.</li>
              <li>Model numbers are estimates and must be labelled as such; the <span className="font-mono text-[13px]">source</span> field tells you which is which.</li>
              <li>Cam frames are linked, not redistributed. Do not describe a frame the assistant has not fetched.</li>
              <li>
                Full terms:{" "}
                <Link href={CONNECT_LINKS.terms.href} prefetch={false} className={linkClass}>
                  {absolute("terms")}
                </Link>
                . Privacy:{" "}
                <Link href={CONNECT_LINKS.privacy.href} prefetch={false} className={linkClass}>
                  {CONNECT_LINKS.privacy.label.toLowerCase()}
                </Link>
                . Questions: <a href="mailto:hello@peakcam.io" className={linkClass}>hello@peakcam.io</a>.
              </li>
            </ul>
          </div>
        </section>

        {/* 5. Without MCP */}
        <section aria-labelledby="without-mcp" className="mt-14 scroll-mt-20">
          <SectionHeading id="without-mcp" eyebrow="5 · Without MCP">
            The same data over plain HTTP
          </SectionHeading>
          <p className="mt-4 max-w-3xl text-[15.5px] leading-relaxed text-ink">
            Every surface is anonymous, CORS-open, cached fifteen minutes and carries{" "}
            <span className="font-mono text-[13px]">X-Attribution</span> and <span className="font-mono text-[13px]">Link</span>{" "}
            author and license headers. Swap <span className="font-mono text-[13px]">breckenridge</span> for any slug from the
            resort list.
          </p>
          <ul className="mt-4 rounded-[18px] border-[1.5px] border-ink bg-cream-50 px-5 shadow-stamp">
            <UrlRow href={CONNECT_LINKS.apiResorts.href} label="REST: every resort" note="Light list with headline numbers, rating, season status and cam counts." />
            <UrlRow href={CONNECT_LINKS.apiResort.href} label="REST: one resort" note="Full document with provenance per field, season and cams." />
            <UrlRow href={CONNECT_LINKS.apiCams.href} label="REST: a resort's cams" note="Active cams with live health and still-image URLs." />
            <UrlRow href={CONNECT_LINKS.apiPowder.href} label="REST: powder ranking" note="Ranked new snow; source=snotel keeps measured resorts only. Also window, state, minInches, limit." />
            <UrlRow href={CONNECT_LINKS.apiAsk.href} label="REST: ask a question" note="Deterministic: the resort and intent from the wording, one tool call, a dated sentence and citations. answerable: false instead of a guess. GET ?q= or POST {query}." />
            <UrlRow href={CONNECT_LINKS.nlwebAsk.href} label="NLWeb: /ask" note="The same answer in the NLWeb list shape (query_id, results with schema_object), for clients that speak that protocol." />
            <UrlRow href={CONNECT_LINKS.apiBatch.href} label="REST: batch" note="POST up to 10 GET paths as {requests:[{path}]} and get each route's status and body in order; one request against the rate limit." />
            <UrlRow href={CONNECT_LINKS.apiSearchIndex.href} label="REST: search index" note="Slug, name, aliases, state, country and coordinates for every resort, cached a day, for matching names on your side." />
            <UrlRow href={CONNECT_LINKS.apiStatus.href} label="REST: service status" note="Snow-report freshness and cam health against stated thresholds; 200 with status: degraded when a check fails." />
            <UrlRow href={CONNECT_LINKS.openapi.href} label="OpenAPI 3.1" note="Generated from the same schemas the MCP tools use." />
            <UrlRow href={CONNECT_LINKS.schemas.href} label="JSON Schemas" note="One standalone draft 2020-12 document per shape: resort.json, cams.json, powder.json, status.json, ask.json and the parts they reference." />
            <UrlRow href={CONNECT_LINKS.apiCatalog.href} label="API catalog" note="RFC 9727 linkset for crawlers that know the convention." />
            <UrlRow href={CONNECT_LINKS.indexMd.href} label="Markdown: site index" note="Every resort in one document; each HTML page also advertises its alternate in a Link header." />
            <UrlRow href={CONNECT_LINKS.resortMd.href} label="Markdown: one resort" note="Byte-identical to the MCP resource peakcam://resorts/{slug}." />
            <UrlRow href={CONNECT_LINKS.powderAtom.href} label="Atom: powder feed" note="An entry when a report crosses 6 in. in 24 h or a storm is logged. Per-subscriber Atom and iCal live on the manage page." />
            <UrlRow href={CONNECT_LINKS.llms.href} label="llms.txt" note="Site map for answer engines with current snow numbers per resort." />
            <UrlRow href={CONNECT_LINKS.llmsFull.href} label="llms-full.txt" note="The long guide: every tool with an example call, every REST route with curl, attribution and the rate limit as it really behaves." />
            <UrlRow href={CONNECT_LINKS.gptInstructions.href} label="Custom GPT instructions" note="Paste into a ChatGPT Custom GPT and import the OpenAPI document as its Action." />
            <UrlRow href={CONNECT_LINKS.serverCard.href} label="MCP server card" note="SEP-2127 card: name, version, endpoint, supported protocol revisions. Also at /api/mcp/server-card." />
            <UrlRow href={CONNECT_LINKS.robots.href} label="robots.txt" note="Per-crawler rules plus a Content-Signal line (search, ai-input and ai-train allowed)." />
          </ul>
        </section>

        <nav aria-label="Related pages" className="mt-12 flex flex-wrap gap-3 text-sm">
          <Link href={CONNECT_LINKS.snowReport.href} prefetch={false} className={chipClass}>
            Live snow report
          </Link>
          <Link href={CONNECT_LINKS.alerts.href} prefetch={false} className={chipClass}>
            Powder alerts
          </Link>
          <Link href={CONNECT_LINKS.methodology.href} prefetch={false} className={chipClass}>
            Methodology
          </Link>
          <Link href={CONNECT_LINKS.about.href} prefetch={false} className={chipClass}>
            About
          </Link>
          <a href={EXTERNAL_LINKS.mcpSpec} rel="noopener noreferrer" className={chipClass}>
            What is MCP?
          </a>
        </nav>
      </main>
      <PeakFooter />
    </>
  );
}
