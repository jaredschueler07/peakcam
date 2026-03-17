#!/usr/bin/env node

/**
 * PeakCam Agent Messenger
 *
 * Sends Slack messages as a specific agent bot.
 *
 * Usage:
 *   node agents/send.mjs <agent> <channel?> "message"
 *
 * Examples:
 *   node agents/send.mjs sales "Pipeline update: 3 deals moved to closed-won this week"
 *   node agents/send.mjs engineering C0ALF8QJ2TZ "Deploy checklist complete for v2.1"
 *   node agents/send.mjs product --broadcast "New feature spec published: Resort Favorites"
 *
 * Requires .env.local with SLACK_BOT_TOKEN_<AGENT> for each agent.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env
const envPath = resolve(__dirname, '..', '.env.local');
try {
  const envFile = readFileSync(envPath, 'utf-8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // .env.local is optional if env vars are set directly
}

// Load agent config
const config = JSON.parse(readFileSync(resolve(__dirname, 'agents.json'), 'utf-8'));

// Parse args
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node agents/send.mjs <agent> [--broadcast | channel_id] "message"');
  console.error('Agents:', Object.keys(config.agents).join(', '));
  process.exit(1);
}

const agentName = args[0].toLowerCase();
const agent = config.agents[agentName];
if (!agent) {
  console.error(`Unknown agent: ${agentName}`);
  console.error('Available:', Object.keys(config.agents).join(', '));
  process.exit(1);
}

let channel, message;
if (args[1] === '--broadcast') {
  channel = config.broadcast_channel.id;
  message = args.slice(2).join(' ');
} else if (args[1].startsWith('C0') || args[1].startsWith('C')) {
  channel = args[1];
  message = args.slice(2).join(' ');
} else {
  channel = agent.channel;
  message = args.slice(1).join(' ');
}

const token = process.env[agent.token_env];
if (!token) {
  console.error(`Missing token: Set ${agent.token_env} in .env.local`);
  console.error(`\nTo get this token:`);
  console.error(`1. Go to https://api.slack.com/apps`);
  console.error(`2. Find "${agent.name}" app`);
  console.error(`3. Go to OAuth & Permissions`);
  console.error(`4. Copy the "Bot User OAuth Token" (starts with xoxb-)`);
  console.error(`5. Add to .env.local: ${agent.token_env}=xoxb-your-token-here`);
  process.exit(1);
}

// Send message via Slack Web API
async function sendMessage() {
  const resp = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channel,
      text: message,
      unfurl_links: false,
    }),
  });

  const data = await resp.json();
  if (!data.ok) {
    console.error(`Slack API error: ${data.error}`);
    if (data.error === 'not_in_channel') {
      console.error(`\nThe bot needs to be invited to the channel first.`);
      console.error(`In Slack, go to the channel and type: /invite @${agent.name}`);
    }
    process.exit(1);
  }

  console.log(`[${agent.name}] Message sent to ${channel}`);
  console.log(`Timestamp: ${data.ts}`);
  return data;
}

sendMessage().catch(err => {
  console.error('Failed to send:', err.message);
  process.exit(1);
});
