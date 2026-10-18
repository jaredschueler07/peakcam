// Station layer barrel: the normalised shapes, the per-source fetchers and
// the role assignment. Each module is importable on its own; nothing here
// touches the database (scripts/stations-sync.ts does) or Next.js.
export * from "./types";
export * from "./assign";
export * as snotel from "./snotel";
export * as nws from "./nws-observations";
export * as ghcn from "./ghcn";
export * as bcAsws from "./bc-asws";
export * as eccc from "./eccc";
export * as roadCams from "./road-cams";

import { SNOTEL_ATTRIBUTION, SNOTEL_TERMS_URL } from "./snotel";
import { NWS_ATTRIBUTION, NWS_TERMS_URL } from "./nws-observations";
import { GHCN_ATTRIBUTION, GHCN_TERMS_URL } from "./ghcn";
import { BC_ASWS_ATTRIBUTION, BC_ASWS_TERMS_URL } from "./bc-asws";
import { ECCC_ATTRIBUTION, ECCC_TERMS_URL } from "./eccc";
import type { StationSource } from "./types";

export interface SourceInfo {
  /** Short label for a table cell. */
  label: string;
  /** The attribution line the terms ask for. */
  attribution: string;
  termsUrl: string;
  /** How often the provider publishes. */
  cadence: "daily" | "hourly";
}

/** One row per provider, shared by the API, the page, the MCP tool and docs/stations.md. */
export const STATION_SOURCES: Record<StationSource, SourceInfo> = {
  snotel: { label: "SNOTEL", attribution: SNOTEL_ATTRIBUTION, termsUrl: SNOTEL_TERMS_URL, cadence: "daily" },
  ghcn: { label: "GHCN-Daily", attribution: GHCN_ATTRIBUTION, termsUrl: GHCN_TERMS_URL, cadence: "daily" },
  nws: { label: "NWS", attribution: NWS_ATTRIBUTION, termsUrl: NWS_TERMS_URL, cadence: "hourly" },
  bc_asws: { label: "BC ASWS", attribution: BC_ASWS_ATTRIBUTION, termsUrl: BC_ASWS_TERMS_URL, cadence: "hourly" },
  eccc: { label: "ECCC", attribution: ECCC_ATTRIBUTION, termsUrl: ECCC_TERMS_URL, cadence: "hourly" },
};
