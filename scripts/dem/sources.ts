import type { ResortBakeConfig } from "../../lib/game/terrain/resorts";

export type DemSource =
  | { kind: "3dep"; project: string }
  | { kind: "copernicus"; tile: string }
  | { kind: "terrarium" };

export type DemAttribution = {
  name: string;
  licence: string;
  notice: string[];
};

/** Resort DEMs are design inputs: never infer a source from geography. */
export function resolveDemSource(cfg: ResortBakeConfig): DemSource {
  return cfg.demSource;
}

export function attributionFor(source: DemSource): DemAttribution {
  switch (source.kind) {
    case "3dep":
      return {
        name: "USGS 3D Elevation Program (3DEP)",
        licence: "United States public domain",
        notice: ["Source: U.S. Geological Survey 3D Elevation Program."],
      };
    case "copernicus":
      return {
        name: "Copernicus DEM GLO-30",
        licence: "Copernicus DEM Licence",
        notice: [
          "Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.",
          "Article 6(c) liability disclaimer required: no warranty and limitation of liability; reproduce the canonical licence notice verbatim when distributing derived data.",
        ],
      };
    case "terrarium":
      return {
        name: "AWS Terrain Tiles (Mapzen / Tilezen Terrarium)",
        licence: "Mixed-source licences, including CC-BY inputs",
        notice: [
          "Terrarium fallback attaches source-specific CC-BY attribution obligations; preserve every applicable Mapzen/Tilezen source credit.",
        ],
      };
  }
}
