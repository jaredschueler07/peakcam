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
      "components/ui/FavoriteButton.tsx",
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
]);

export default eslintConfig;
