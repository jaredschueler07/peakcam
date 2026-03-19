# PeakCam Day 1 Plan — Tuesday, March 17, 2026

## Sprint 1: Foundation Week — Day 1 of 5

**Goal:** Agent loop service running, every team responsive in Slack, first deliverables in progress by EOD.

---

## Pre-Flight: Start the Agent Service (7:45 AM)

The agent loop (`agents/loop.mjs`) runs as a persistent launchd service. Before anything else:

### 1. Verify Prerequisites
- [ ] Confirm `ANTHROPIC_API_KEY` is set in `.env.local`
- [ ] Confirm all 8 `SLACK_BOT_TOKEN_*` vars are in `.env.local`
- [ ] Run `node agents/join-channels.mjs` (ensures all bots in all channels)

### 2. Dry Run First
```bash
cd ~/peakcam && node agents/loop.mjs --dry-run
```
Verify: all 8 agents come online, skills load, no token errors. Then Ctrl+C.

### 3. Start the Service
```bash
launchctl start com.peakcam.agents
```
Or if the plist isn't installed yet:
```bash
cp agents/com.peakcam.agents.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.peakcam.agents.plist
launchctl start com.peakcam.agents
```
Monitor: `tail -f agents/loop.log`

### 4. Smoke Test
@mention each bot in its channel with a simple question. Verify it responds in-thread.

### How the Loop Works
- Polls all 8 channels every 5 seconds
- Responds when @mentioned or in threads where the bot has already replied
- Auto-selects the top 2 most relevant skills per message (keyword scoring)
- Supports cross-agent handoffs: if Engineering gets a Data question, it tags `[HANDOFF:data]` and the system routes it automatically
- Rate-limited: 1.5s minimum between Claude API calls, Slack 429 retry handling
- Long responses auto-chunked at 4000 chars (Slack limit)

### MCP Integrations (Available but not yet wired)
Each plugin has `.mcp.json` configs for external services. These aren't in the loop yet (the loop calls Claude API directly, no tool use), but the configs are ready for when the loop adds MCP support:

| Agent | Connected Services |
|-------|-------------------|
| **Engineering** | GitHub, Linear, Asana, Atlassian, PagerDuty, Datadog, Notion |
| **Data** | Snowflake, Databricks, BigQuery, Hex, Amplitude, Notion |
| **Sales** | HubSpot, Close, Clay, ZoomInfo, Apollo, Outreach, Fireflies, SimilarWeb |
| **Marketing** | Canva, Figma, HubSpot, Amplitude, Ahrefs, SimilarWeb, Klaviyo |
| **Product** | Linear, Figma, Amplitude, Pendo, Intercom, Fireflies, SimilarWeb |
| **Productivity** | Asana, Linear, Monday, ClickUp, MS365, Notion |
| **Finance** | Snowflake, Databricks, BigQuery, MS365, Notion |
| **Operations** | Atlassian, Asana, ServiceNow, MS365, Notion |

All agents also have: Slack, Google Calendar, Gmail

---

## Morning Block (8:00 AM – 12:00 PM)

### 🟣 Productivity (8:00 AM — First to move)
**Owner:** PeakCam Productivity
**Deliverable:** Working memory + task tracking live

- [ ] Initialize `TASKS.md` with all 27 Sprint 1-4 tasks from Notion
- [ ] Bootstrap `CLAUDE.md` working memory with project context from repo
- [ ] Create `memory/` directory structure:
  - `memory/glossary.md` — SNOTEL, SWE, ISR, RLS, NWS, Alpine Bold, etc.
  - `memory/projects/peakcam-v0.md` — architecture, tech stack, data model
  - `memory/context/company.md` — team structure, channels, tools
- [ ] Post morning standup template to #all-peakcam
- [ ] Set up daily standup shortcut (cron: `0 8 * * 1-5`)

### 🔵 Engineering (8:30 AM)
**Owner:** PeakCam Engineering
**Deliverable:** Vercel deployed + Alpine Bold tokens committed

**Vercel Migration (AM focus):**
- [ ] Create Vercel project linked to GitHub repo
- [ ] Configure environment variables:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (for API routes/scripts)
- [ ] First deploy — verify browse page + resort detail pages render
- [ ] Set up preview deploys for PR branches
- [ ] Verify ISR revalidation working (1-hour for resort pages)

**Alpine Bold Kickoff (late AM):**
- [ ] Create branch: `feat/alpine-bold-design-system`
- [ ] Update `tailwind.config.ts` with Alpine Bold tokens:
  - Colors: dark slate `#1e293b`, snow white `#f8fafc`, alpine blue `#3b82f6`
  - Accent: summit orange `#f97316`, forest green `#22c55e`
  - Typography: Inter (body), JetBrains Mono (data/code)
- [ ] Update CSS variables in `app/globals.css`

### 🟠 Product (8:30 AM)
**Owner:** PeakCam Product
**Deliverable:** V0 feature spec draft by noon

- [ ] Read full `CLAUDE.md` and review every existing page/component
- [ ] Define V0 scope document:
  - **Ships in V0:** Mobile-first resort detail redesign, /snow-report page, /about page, SNOTEL integration, Alpine Bold, SEO meta tags
  - **Deferred to V0.5:** Interactive map improvements, user accounts, favorites, affiliate links, resort comparison tool
- [ ] Write acceptance criteria for each V0 feature
- [ ] Create wireframe descriptions for mobile-first resort detail layout:
  - Hero webcam (primary cam, click-to-play)
  - Snow conditions card (SNOTEL data, base depth, new snow)
  - 5-day weather forecast (existing NWS integration)
  - Trail/lift stats
  - Additional cams grid
- [ ] Share draft in #peakcam-product for review

### 🟣 Data (9:00 AM)
**Owner:** PeakCam Data
**Deliverable:** SNOTEL station audit started

- [ ] Review existing database schema — especially `resorts.snotel_station_id` field
- [ ] Query Supabase to inventory which resorts have SNOTEL station IDs vs. null
- [ ] Research NRCS SNOTEL API:
  - Endpoint: `https://wcc.sc.egov.usda.gov/reportGenerator/`
  - Available data: snow depth, SWE (snow water equivalent), temperature
  - Rate limits, authentication requirements
  - Response format (CSV vs JSON)
- [ ] Build station mapping spreadsheet:
  - Resort name → SNOTEL station ID → Station name → Elevation → Data availability
  - Flag resorts with no nearby SNOTEL station
  - Note coverage gaps by state/region
- [ ] Test API call for 3-5 stations to validate data quality
- [ ] Post findings to #peakcam-data

### 🟡 Marketing (9:00 AM)
**Owner:** PeakCam Marketing
**Deliverable:** Brand positioning outline

- [ ] Review current site design and messaging (dark midnight navy theme)
- [ ] Research competitor positioning:
  - OnTheSnow, OpenSnow, SkiResort.info, ZRankings
  - What makes PeakCam different? (Real webcams + real-time SNOTEL + clean UI)
- [ ] Draft Alpine Bold brand positioning:
  - **Voice:** Authoritative but approachable. "Your mountain intel, not marketing."
  - **Audience:** Core skiers/riders who check conditions daily, not casual tourists
  - **Differentiator:** Real data (SNOTEL), real views (webcams), no ads/noise
  - **Visual identity:** Dark slate base, alpine blue accents, clean typography
- [ ] Outline messaging pillars (3-4 core themes)
- [ ] Post outline to #peakcam-marketing for feedback

---

## Afternoon Block (1:00 PM – 5:00 PM)

### 🔵 Engineering (1:00 PM)
**Owner:** PeakCam Engineering
**Deliverable:** Alpine Bold PR ready for review

- [ ] Apply Alpine Bold tokens to existing components:
  - `Header.tsx` — update background, text colors, logo treatment
  - `Badge.tsx` — update condition color palette
  - `Chip.tsx` — filter chip styling
  - `Button.tsx` — primary/secondary variants
- [ ] Update `BrowsePage.tsx` — card backgrounds, hover states, borders
- [ ] Update `ResortDetailPage.tsx` — section headers, data displays
- [ ] Test dark theme rendering across all pages
- [ ] Push branch, open PR, request Product review
- [ ] Coordinate with Operations on Vercel custom domain config

### 🟢 Operations (1:00 PM)
**Owner:** PeakCam Operations
**Deliverable:** Hosting infrastructure documented

- [ ] Review Vercel project setup (coordinate with Engineering)
- [ ] Document environment variable management:
  - Which vars are in Vercel dashboard
  - Which are in `.env.local` for local dev
  - Secret rotation procedures
- [ ] Verify Vercel free tier limits vs. projected usage:
  - Bandwidth: 100 GB/month (sufficient for V0)
  - Serverless function invocations: 100K/month
  - Build minutes: 6000/month
  - Edge middleware invocations: 1M/month
- [ ] DNS configuration plan (if custom domain):
  - Current domain? Or new domain for V0?
  - SSL auto-provisioned by Vercel
- [ ] Start deployment workflow document:
  - Branch → PR → Preview deploy → Review → Merge → Production
  - Rollback: Vercel instant rollback via dashboard
- [ ] Post infra status to #peakcam-operations

### 💰 Finance (1:00 PM)
**Owner:** PeakCam Finance
**Deliverable:** V0 budget baseline spreadsheet

- [ ] Inventory all V0 costs:
  - **Vercel:** Free (Hobby plan) — $0/month for V0
  - **Supabase:** Free tier — $0/month (500MB DB, 1GB storage, 2GB bandwidth)
  - **PostHog:** Free tier — $0/month (1M events/month)
  - **Domain:** ~$12/year (if registering new)
  - **Slack:** Free tier for bots — $0
  - **GitHub:** Free tier — $0
  - **Total V0 projected:** ~$1/month (domain amortized)
- [ ] Document upgrade trigger thresholds:
  - When does Vercel need Pro? (>100GB bandwidth, team features)
  - When does Supabase need Pro? (>500MB DB or >50K monthly active users)
  - When does PostHog need paid? (>1M events/month)
- [ ] Create simple cost tracking spreadsheet
- [ ] Post budget summary to #peakcam-finance

### 📊 Data (2:00 PM)
**Owner:** PeakCam Data
**Deliverable:** Station audit complete, coverage report posted

- [ ] Complete station mapping for all 73 resorts
- [ ] Categorize coverage:
  - **Green:** Direct SNOTEL station match (station on-mountain or <5mi)
  - **Yellow:** Nearby station available (5-15mi, similar elevation)
  - **Red:** No good SNOTEL coverage (will need manual reports or resort API)
- [ ] Draft data quality assessment:
  - Stations with consistent daily updates
  - Stations with gaps or seasonal-only data
  - Recommended fallback strategy for red-zone resorts
- [ ] Post coverage report to #peakcam-data and #peakcam-engineering

### 💼 Sales (2:00 PM)
**Owner:** PeakCam Sales
**Deliverable:** Research kickoff — competitive landscape outline

- [ ] Map the competitive landscape:
  - **Direct competitors:** OnTheSnow (owned by Mountain News/Vail), OpenSnow (subscription model), ZRankings (data-focused)
  - **Indirect:** Resort own websites, weather apps with ski features
  - **Adjacent:** Alltrails (hiking model worth studying), NOAA Weather
- [ ] Identify affiliate program landscape:
  - Ski pass providers (Ikon, Epic) — do they have affiliate programs?
  - Gear retailers (REI, Backcountry.com, evo) — commission rates?
  - Travel/lodging (Booking.com, Expedia ski packages)
- [ ] Create research tracker with sources and deadlines
- [ ] Post research plan outline to #peakcam-sales

### 🟡 Marketing (3:00 PM)
**Owner:** PeakCam Marketing
**Deliverable:** Brand positioning draft v1

- [ ] Expand morning outline into full brand positioning document:
  - Executive summary (1 paragraph)
  - Target audience persona
  - Competitive positioning map
  - Voice & tone guidelines with examples
  - Visual identity summary (Alpine Bold palette, typography, imagery direction)
  - Messaging pillars with example copy
- [ ] Draft tagline candidates (3-5 options)
- [ ] Share v1 in #peakcam-marketing and #peakcam-product

---

## End of Day Sync (4:30 PM)

### 🟣 Productivity runs EOD standup
- [ ] Collect status from all channels
- [ ] Update `TASKS.md` with Day 1 progress
- [ ] Post EOD summary to #all-peakcam:
  - What shipped today
  - What's blocked
  - Tomorrow's priorities
- [ ] Update Notion Sprint 1 task statuses

---

## Day 1 Success Criteria

| Team | Must Complete | Stretch |
|------|--------------|---------|
| **Productivity** | TASKS.md + CLAUDE.md + memory bootstrapped | Daily standup shortcut live |
| **Engineering** | Vercel deployed + Alpine Bold PR open | Custom domain configured |
| **Product** | V0 scope doc + acceptance criteria | Mobile wireframe descriptions |
| **Data** | SNOTEL audit started, 3+ API tests | Full 73-resort coverage map |
| **Marketing** | Brand positioning outline | Full v1 document |
| **Operations** | Hosting documented, limits verified | Deployment workflow draft |
| **Finance** | Budget baseline spreadsheet | Upgrade threshold analysis |
| **Sales** | Competitive landscape outline | Affiliate program research started |

---

## Cross-Team Dependencies for Day 1

```
Engineering ←→ Operations : Vercel setup coordination (morning)
Product → Engineering    : Spec informs Alpine Bold component priorities
Data → Engineering       : SNOTEL API findings inform lib/snotel.ts design
Marketing → Product      : Brand voice shapes spec language
Productivity → All       : TASKS.md is single source of truth
```

## Key Files to Create/Modify Today

```
NEW:  TASKS.md                           (Productivity)
NEW:  CLAUDE.md updates                  (Productivity)
NEW:  memory/glossary.md                 (Productivity)
NEW:  memory/projects/peakcam-v0.md      (Productivity)
MOD:  tailwind.config.ts                 (Engineering — Alpine Bold)
MOD:  app/globals.css                    (Engineering — Alpine Bold)
MOD:  components/ui/*.tsx                (Engineering — Alpine Bold)
NEW:  docs/v0-feature-spec.md           (Product)
NEW:  docs/brand-positioning.md          (Marketing)
NEW:  docs/v0-budget.md                  (Finance)
NEW:  docs/infrastructure.md             (Operations)
```
