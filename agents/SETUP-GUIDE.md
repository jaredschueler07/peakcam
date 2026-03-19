# PeakCam Agent Team — Slack Bot Setup Guide

## Overview

This sets up 8 Slack bot identities so each AI agent posts as itself:

| Agent | Bot Name | Channel | Skills |
|-------|----------|---------|--------|
| Sales | PeakCam Sales | #peakcam-sales | Account research, outreach, pipeline, forecasting |
| Engineering | PeakCam Engineering | #peakcam-engineering | Code review, standups, incidents, architecture |
| Product | PeakCam Product | #peakcam-product | Specs, roadmaps, sprint planning, research |
| Marketing | PeakCam Marketing | #peakcam-marketing | Content, campaigns, SEO, brand review |
| Operations | PeakCam Operations | #peakcam-operations | Processes, runbooks, compliance, risk |
| Finance | PeakCam Finance | #peakcam-finance | Journal entries, reconciliation, variance |
| Data | PeakCam Data | #peakcam-data | SQL, dashboards, visualization, analysis |
| Productivity | PeakCam Productivity | #peakcam-productivity | Tasks, memory, daily planning |

## Quick Setup (Interactive)

```bash
node agents/setup.mjs
```

This walks you through creating each bot step by step and saves tokens automatically.

## Manual Setup (Per Bot)

Repeat for each agent:

### 1. Create the Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From a manifest**
3. Select the **PeakCam** workspace
4. Switch to the **YAML** tab
5. Paste the contents of `agents/manifests/<agent>.yaml`
6. Click **Create**

### 2. Install to Workspace

1. On the app page, click **Install to Workspace**
2. Review the permissions and click **Allow**

### 3. Get the Bot Token

1. In the sidebar, go to **OAuth & Permissions**
2. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

### 4. Save the Token

Add to your `.env.local`:

```
SLACK_BOT_TOKEN_SALES=xoxb-your-token-here
SLACK_BOT_TOKEN_ENGINEERING=xoxb-your-token-here
SLACK_BOT_TOKEN_PRODUCT=xoxb-your-token-here
SLACK_BOT_TOKEN_MARKETING=xoxb-your-token-here
SLACK_BOT_TOKEN_OPERATIONS=xoxb-your-token-here
SLACK_BOT_TOKEN_FINANCE=xoxb-your-token-here
SLACK_BOT_TOKEN_DATA=xoxb-your-token-here
SLACK_BOT_TOKEN_PRODUCTIVITY=xoxb-your-token-here
```

### 5. Invite Bots to Channels

In each Slack channel, run:

```
/invite @PeakCam Sales        (in #peakcam-sales)
/invite @PeakCam Engineering  (in #peakcam-engineering)
/invite @PeakCam Product      (in #peakcam-product)
/invite @PeakCam Marketing    (in #peakcam-marketing)
/invite @PeakCam Operations   (in #peakcam-operations)
/invite @PeakCam Finance      (in #peakcam-finance)
/invite @PeakCam Data         (in #peakcam-data)
/invite @PeakCam Productivity (in #peakcam-productivity)
```

Also invite all bots to `#all-peakcam` for cross-team announcements.

## Verification

```bash
node agents/setup.mjs verify
```

## Sending Messages

```bash
# Post to agent's default channel
node agents/send.mjs sales "Pipeline update: 3 deals moved to closed-won"

# Post to a specific channel
node agents/send.mjs engineering C0ALF8QJ2TZ "Deploy checklist complete"

# Broadcast to #all-peakcam
node agents/send.mjs product --broadcast "New feature spec published"
```

## File Structure

```
agents/
  agents.json         # Agent config (names, channels, skills, token env vars)
  send.mjs            # Send a message as any agent bot
  setup.mjs           # Interactive setup wizard
  SETUP-GUIDE.md      # This file
  manifests/
    sales.yaml        # Slack app manifest for each agent
    engineering.yaml
    product.yaml
    marketing.yaml
    operations.yaml
    finance.yaml
    data.yaml
    productivity.yaml
```
