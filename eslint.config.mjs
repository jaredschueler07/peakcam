import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored/standalone artifacts are not authored against the app ruleset.
    "public/drop-in/three.module.js",
    "dashboard/**",
  ]),
  // Existing legacy UI/script debt is intentionally scoped rather than
  // weakening these rules for new code.
  {
    files: [
      "components/resort/ConditionVoter.tsx",
      "components/resort/UserConditionsForm.tsx",
      "components/resort/UserConditionsList.tsx",
      "scripts/snotel-sync.ts",
    ],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    files: [
      "components/cam/CamReportButton.tsx",
      "components/layout/Header.tsx",
    ],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
  {
    files: ["components/snow-report/SnowReportPage.tsx"],
    rules: { "react-hooks/static-components": "off" },
  },
  {
    files: [
      "components/alerts/AlertManagePage.tsx",
      "components/alerts/PowderAlertSignup.tsx",
    ],
    rules: { "react/no-unescaped-entities": "off" },
  },
  {
    files: [
      "lib/game/core/**/*.{ts,tsx}",
      "lib/game/physics/**/*.{ts,tsx}",
      "lib/game/terrain/**/*.{ts,tsx}",
      "lib/game/replay/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["react", "react/*", "react-dom", "react-dom/*"], message: "The deterministic game core cannot depend on React or the DOM." },
            { group: ["three", "three/*"], message: "Use plain Vec3 values in the deterministic game core." },
            { group: ["next", "next/*", "posthog-js", "@supabase/*", "node:http", "node:http/*", "node:https", "node:https/*", "node:net", "node:tls", "undici", "axios", "howler", "tone", "standardized-audio-context"], message: "The deterministic game core cannot perform browser, network, audio, or analytics work." },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        "window", "document", "navigator", "fetch", "XMLHttpRequest", "WebSocket",
        "EventSource", "AudioContext", "webkitAudioContext",
      ],
    },
  },
]);

export default eslintConfig;
