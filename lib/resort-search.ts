import type { Resort } from "./types";

const aliases: Record<string, string> = { CO: "Colorado", UT: "Utah", CA: "California", BC: "British Columbia", WY: "Wyoming", VT: "Vermont", NH: "New Hampshire", ME: "Maine", NY: "New York", MT: "Montana", ID: "Idaho", OR: "Oregon", WA: "Washington", NM: "New Mexico", AZ: "Arizona", NV: "Nevada", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", WI: "Wisconsin", PA: "Pennsylvania", WV: "West Virginia", VA: "Virginia", MD: "Maryland", NC: "North Carolina" };
const countries: Record<string, string> = { US: "United States USA", CA: "Canada", CL: "Chile", AR: "Argentina" };
const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
export function matchesResortSearch(resort: Pick<Resort, "name" | "state" | "region" | "country">, query: string): boolean {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const text = normalize(`${resort.name} ${resort.state} ${aliases[resort.state] ?? ""} ${resort.region} ${resort.country} ${countries[resort.country] ?? ""}`);
  return terms.every(term => text.includes(term));
}
