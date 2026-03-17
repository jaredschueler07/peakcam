#!/usr/bin/env node

/**
 * Sends a hello message from each agent bot to their channel.
 * Run this to verify all bots are working after setup.
 *
 * Usage: node agents/test-all.mjs
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
} catch {}

const config = JSON.parse(readFileSync(resolve(__dirname, 'agents.json'), 'utf-8'));

const greetings = {
  sales: "Hey team! :wave: PeakCam Sales agent is online. I'll be handling account research, outreach, pipeline reviews, and daily briefings. Let's close some deals!",
  engineering: "Hey team! :wave: PeakCam Engineering agent is online. I'll be handling standups, code reviews, incident response, and architecture decisions. Let's ship!",
  product: "Hey team! :wave: PeakCam Product agent is online. I'll be handling feature specs, roadmap updates, sprint planning, and research synthesis. Let's build the right things!",
  marketing: "Hey team! :wave: PeakCam Marketing agent is online. I'll be handling content creation, campaign planning, SEO audits, and brand reviews. Let's grow!",
  operations: "Hey team! :wave: PeakCam Operations agent is online. I'll be handling process docs, runbooks, compliance tracking, and risk assessments. Let's run smooth!",
  finance: "Hey team! :wave: PeakCam Finance agent is online. I'll be handling journal entries, reconciliation, variance analysis, and close management. Let's keep the books clean!",
  data: "Hey team! :wave: PeakCam Data agent is online. I'll be handling SQL queries, dashboards, data exploration, and statistical analysis. Let's find the insights!",
  productivity: "Hey team! :wave: PeakCam Productivity agent is online. I'll be handling task management, daily planning, and memory tracking. Let's stay organized!"
};

async function sendMessage(token, channel, text, agentName) {
  const resp = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel, text, unfurl_links: false }),
  });
  const data = await resp.json();
  if (data.ok) {
    console.log(`  [x] ${agentName} -> ${channel}`);
  } else {
    console.log(`  [ ] ${agentName} -> FAILED: ${data.error}`);
    if (data.error === 'not_in_channel') {
      console.log(`      Fix: In Slack, go to the channel and type: /invite @${agentName}`);
    }
  }
  return data;
}

console.log('\n  PeakCam Agent Team — Sending Hello Messages\n');

for (const [key, agent] of Object.entries(config.agents)) {
  const token = process.env[agent.token_env];
  if (!token) {
    console.log(`  [ ] ${agent.name} — no token found (${agent.token_env})`);
    continue;
  }
  await sendMessage(token, agent.channel, greetings[key], agent.name);
}

console.log('\n  Done! Check your Slack channels.\n');
