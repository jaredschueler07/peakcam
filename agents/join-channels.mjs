#!/usr/bin/env node

/**
 * Has each agent bot join ALL channels (not just its own).
 * This lets any agent post in any team channel.
 *
 * Usage: node agents/join-channels.mjs
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

async function joinChannel(token, channelId, agentName) {
  const resp = await fetch('https://slack.com/api/conversations.join', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel: channelId }),
  });
  const data = await resp.json();
  if (data.ok) {
    console.log(`  [x] ${agentName} joined ${channelId}`);
  } else if (data.error === 'missing_scope') {
    console.log(`  [!] ${agentName} needs channels:join scope — see note below`);
  } else {
    console.log(`  [ ] ${agentName} failed: ${data.error}`);
  }
  return data;
}

// Collect all channel IDs (each agent's channel + broadcast)
const allChannels = [
  ...Object.values(config.agents).map(a => ({ id: a.channel, name: a.channel_name })),
  { id: config.broadcast_channel.id, name: config.broadcast_channel.name },
];

console.log('\n  PeakCam Agent Team — Joining ALL Channels\n');
console.log(`  Channels: ${allChannels.map(c => c.name).join(', ')}\n`);

let needsScope = false;

for (const [key, agent] of Object.entries(config.agents)) {
  const token = process.env[agent.token_env];
  if (!token) {
    console.log(`  [ ] ${agent.name} — no token (${agent.token_env})`);
    continue;
  }
  console.log(`  ${agent.name}:`);
  for (const ch of allChannels) {
    const result = await joinChannel(token, ch.id, `${agent.name} -> ${ch.name}`);
    if (result.error === 'missing_scope') needsScope = true;
  }
  console.log('');
}

if (needsScope) {
  console.log(`
  NOTE: Some bots need the "channels:join" scope added.
  For each affected bot:
  1. Go to https://api.slack.com/apps
  2. Click the bot app
  3. Go to OAuth & Permissions
  4. Under "Bot Token Scopes", add "channels:join"
  5. Reinstall the app to your workspace
  Then run this script again.
  `);
}

console.log('\n  Done! Now run: node agents/test-all.mjs\n');
