#!/usr/bin/env node

/**
 * PeakCam Agent Setup Helper
 *
 * Interactive script to walk through creating and configuring
 * all 8 Slack bot apps for the PeakCam agent team.
 *
 * Usage:
 *   node agents/setup.mjs           # Full setup walkthrough
 *   node agents/setup.mjs verify    # Verify all bots are working
 *   node agents/setup.mjs invite    # Generate /invite commands
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(resolve(__dirname, 'agents.json'), 'utf-8'));
const envPath = resolve(__dirname, '..', '.env.local');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

// Load existing env
function loadEnv() {
  const env = {};
  try {
    const envFile = readFileSync(envPath, 'utf-8');
    for (const line of envFile.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    }
  } catch {}
  return env;
}

// Verify a single bot token
async function verifyToken(token, agentName) {
  try {
    const resp = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const data = await resp.json();
    if (data.ok) {
      return { ok: true, bot: data.user, team: data.team };
    }
    return { ok: false, error: data.error };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const command = process.argv[2];

if (command === 'verify') {
  // ------- VERIFY MODE -------
  console.log('\n  PeakCam Agent Team — Token Verification\n');
  const env = loadEnv();
  let allGood = true;

  for (const [key, agent] of Object.entries(config.agents)) {
    const token = env[agent.token_env];
    if (!token) {
      console.log(`  [ ] ${agent.name} — no token (${agent.token_env})`);
      allGood = false;
      continue;
    }
    const result = await verifyToken(token, key);
    if (result.ok) {
      console.log(`  [x] ${agent.name} — connected as @${result.bot} in ${result.team}`);
    } else {
      console.log(`  [ ] ${agent.name} — FAILED: ${result.error}`);
      allGood = false;
    }
  }

  console.log(allGood
    ? '\n  All agents verified!\n'
    : '\n  Some agents need setup. Run: node agents/setup.mjs\n');
  rl.close();

} else if (command === 'invite') {
  // ------- INVITE MODE -------
  console.log('\n  Run these commands in each Slack channel:\n');
  for (const [key, agent] of Object.entries(config.agents)) {
    console.log(`  ${agent.channel_name}:`);
    console.log(`    /invite @${agent.name}\n`);
  }
  // Broadcast channel
  console.log(`  ${config.broadcast_channel.name}:`);
  for (const agent of Object.values(config.agents)) {
    console.log(`    /invite @${agent.name}`);
  }
  console.log('');
  rl.close();

} else {
  // ------- SETUP MODE -------
  console.log(`
  =============================================
   PeakCam Agent Team — Slack Bot Setup
  =============================================

  This will walk you through creating 8 Slack bot apps,
  one for each agent on your team. Each gets its own
  name, avatar, and identity in Slack.

  You'll need:
  - Admin access to your PeakCam Slack workspace
  - A web browser open to https://api.slack.com/apps

  `);

  const env = loadEnv();
  const agents = Object.entries(config.agents);

  for (const [key, agent] of agents) {
    const existing = env[agent.token_env];
    if (existing) {
      const result = await verifyToken(existing, key);
      if (result.ok) {
        console.log(`  [x] ${agent.name} — already configured\n`);
        continue;
      }
    }

    console.log(`  --- Setting up: ${agent.name} ---`);
    console.log(`  1. Go to https://api.slack.com/apps`);
    console.log(`  2. Click "Create New App" -> "From a manifest"`);
    console.log(`  3. Select the "PeakCam" workspace`);
    console.log(`  4. Switch to YAML tab and paste contents of:`);
    console.log(`     agents/manifests/${key === 'product' ? 'product' : key}.yaml`);
    console.log(`  5. Click "Create"`);
    console.log(`  6. Click "Install to Workspace" -> "Allow"`);
    console.log(`  7. Go to "OAuth & Permissions" in the sidebar`);
    console.log(`  8. Copy the "Bot User OAuth Token" (starts with xoxb-)\n`);

    const token = await ask(`  Paste the token for ${agent.name}: `);
    const trimmed = token.trim();
    if (trimmed) {
      env[agent.token_env] = trimmed;

      const result = await verifyToken(trimmed, key);
      if (result.ok) {
        console.log(`  [x] Verified! Connected as @${result.bot}\n`);
      } else {
        console.log(`  [!] Warning: Token check failed (${result.error}) — saved anyway\n`);
      }
    } else {
      console.log(`  Skipped. You can add it later to .env.local\n`);
    }
  }

  // Write updated .env.local
  let envContent = '';
  try {
    envContent = readFileSync(envPath, 'utf-8');
  } catch {}

  // Add agent tokens that aren't already in the file
  const newTokens = [];
  for (const [key, agent] of agents) {
    if (env[agent.token_env] && !envContent.includes(agent.token_env)) {
      newTokens.push(`${agent.token_env}=${env[agent.token_env]}`);
    }
  }

  if (newTokens.length > 0) {
    const section = '\n# PeakCam Agent Bot Tokens\n' + newTokens.join('\n') + '\n';
    writeFileSync(envPath, envContent + section);
    console.log(`  Updated .env.local with ${newTokens.length} new token(s)\n`);
  }

  console.log(`  Next steps:`);
  console.log(`  1. Invite bots to channels:  node agents/setup.mjs invite`);
  console.log(`  2. Verify all bots:          node agents/setup.mjs verify`);
  console.log(`  3. Test sending:             node agents/send.mjs sales "Hello from Sales!"\n`);

  rl.close();
}
