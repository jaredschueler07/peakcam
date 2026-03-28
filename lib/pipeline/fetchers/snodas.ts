// ─────────────────────────────────────────────────────────────
// PeakCam — SNODAS Fetcher
// Downloads SNODAS daily snow-depth grids from NSIDC and
// extracts point values at resort coordinates.
//
// SNODAS grid specs:
//   - 6935 columns x 3351 rows
//   - Lower-left corner: 24.0417°N, 130.5167°W
//   - Cell size: 0.00833° (~1km)
//   - Big-endian int16, values in mm (depth), scale=1
//   - Data files are .dat inside a .tar.gz
// ─────────────────────────────────────────────────────────────

import { SourceReading, emptyReading, ResortContext } from "../types";

// SNODAS grid parameters
const COLS = 6935;
const ROWS = 3351;
const CELL_SIZE = 0.00833333; // degrees
const ORIGIN_LAT = 24.0417;   // lower-left latitude
const ORIGIN_LNG = -130.5167; // lower-left longitude

// In-memory cache for today's grid (downloaded once per run)
let cachedDate: string | null = null;
let cachedGrid: Int16Array | null = null;

/**
 * Convert lat/lng to SNODAS grid coordinates.
 * Returns null if the point falls outside the grid.
 */
function latLngToGrid(lat: number, lng: number): { col: number; row: number } | null {
  const col = Math.round((lng - ORIGIN_LNG) / CELL_SIZE);
  const row = Math.round((lat - ORIGIN_LAT) / CELL_SIZE);

  // SNODAS stores data top-to-bottom in the file, but grid origin is lower-left.
  // Row 0 in file = northernmost row = grid row (ROWS - 1)
  const fileRow = ROWS - 1 - row;

  if (col < 0 || col >= COLS || fileRow < 0 || fileRow >= ROWS) return null;

  return { col, row: fileRow };
}

/**
 * Download and parse the SNODAS snow depth grid for a given date.
 * The SNODAS archive uses masked files organized by date.
 *
 * Note: The actual SNODAS download/extraction is complex (tar.gz with
 * nested .dat files). This implementation provides the framework —
 * in production, consider a pre-processing step or cloud function
 * that extracts the binary grid daily.
 */
async function downloadGrid(dateStr: string): Promise<Int16Array | null> {
  // Return cached grid if same date
  if (cachedDate === dateStr && cachedGrid) return cachedGrid;

  try {
    // SNODAS files are organized as:
    // https://noaadata.apps.nsidc.org/NOAA/G02158/masked/YYYY/MM_Mon/
    // File: SNODAS_YYYYMMDD.tar
    const d = new Date(dateStr);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monAbbr = months[d.getUTCMonth()];
    const dirDate = `${mm}_${monAbbr}`;

    const baseUrl = `https://noaadata.apps.nsidc.org/NOAA/G02158/masked/${yyyy}/${dirDate}`;

    // Try to fetch the tar file
    // SNODAS filenames: SNODAS_YYYYMMDD.tar
    const tarUrl = `${baseUrl}/SNODAS_${yyyy}${mm}${dd}.tar`;

    const res = await fetch(tarUrl, {
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      console.warn(`[PeakCam] SNODAS download failed: ${res.status} for ${tarUrl}`);
      return null;
    }

    const buffer = await res.arrayBuffer();

    // TAR file parsing: find the snow depth .dat file
    // Snow depth product code: 1036 (SNODAS snow depth)
    // Filename pattern: us_ssmv11036tS__T0001TTNATS{YYYY}{MM}{DD}...
    const grid = extractSnowDepthFromTar(new Uint8Array(buffer));
    if (grid) {
      cachedDate = dateStr;
      cachedGrid = grid;
    }

    return grid;
  } catch (err) {
    console.warn("[PeakCam] SNODAS download error:", err);
    return null;
  }
}

/**
 * Extract snow depth grid from SNODAS tar archive.
 * TAR format: 512-byte headers followed by file data, padded to 512.
 * We look for the file containing product code 1036 (snow depth).
 */
function extractSnowDepthFromTar(tar: Uint8Array): Int16Array | null {
  let offset = 0;

  while (offset < tar.length - 512) {
    // Read filename from tar header (first 100 bytes)
    const nameBytes = tar.slice(offset, offset + 100);
    const name = new TextDecoder().decode(nameBytes).replace(/\0/g, "");

    if (!name || name.trim() === "") break; // End of archive

    // Read file size from tar header (bytes 124-135, octal)
    const sizeStr = new TextDecoder()
      .decode(tar.slice(offset + 124, offset + 136))
      .replace(/\0/g, "")
      .trim();
    const fileSize = parseInt(sizeStr, 8);

    if (isNaN(fileSize)) break;

    const dataStart = offset + 512;

    // Look for snow depth file: contains "1036" and ends with ".dat"
    if (name.includes("1036") && name.endsWith(".dat")) {
      const expectedSize = COLS * ROWS * 2; // int16 = 2 bytes per cell

      if (fileSize >= expectedSize) {
        const rawData = tar.slice(dataStart, dataStart + expectedSize);

        // Convert big-endian int16 to native
        const grid = new Int16Array(COLS * ROWS);
        const view = new DataView(rawData.buffer, rawData.byteOffset, rawData.byteLength);

        for (let i = 0; i < COLS * ROWS; i++) {
          grid[i] = view.getInt16(i * 2, false); // big-endian
        }

        return grid;
      }
    }

    // Advance to next tar entry (header + data, padded to 512)
    const paddedSize = Math.ceil(fileSize / 512) * 512;
    offset = dataStart + paddedSize;
  }

  console.warn("[PeakCam] SNODAS: snow depth file (1036) not found in tar");
  return null;
}

export async function fetchSnodas(
  resort: ResortContext,
): Promise<SourceReading | null> {
  try {
    // Use yesterday's date (SNODAS is published with ~1 day lag)
    const yesterday = new Date(Date.now() - 24 * 3600_000);
    const dateStr = yesterday.toISOString().slice(0, 10);

    const grid = await downloadGrid(dateStr);
    if (!grid) return null;

    const coords = latLngToGrid(resort.lat, resort.lng);
    if (!coords) {
      console.warn(`[PeakCam] SNODAS: ${resort.slug} outside grid bounds`);
      return null;
    }

    const idx = coords.row * COLS + coords.col;
    const valueRaw = grid[idx];

    // SNODAS no-data value is typically -9999
    if (valueRaw <= -9999) return null;

    // Value is in mm, convert to inches
    const snowDepthIn = Math.round((valueRaw / 25.4) * 10) / 10;

    const reading = emptyReading(resort.id, "snodas");
    reading.reading_date = dateStr;
    reading.snow_depth_in = snowDepthIn;
    reading.source_confidence = 0.7;
    reading.raw_json = {
      grid_col: coords.col,
      grid_row: coords.row,
      raw_value_mm: valueRaw,
      date: dateStr,
    };

    return reading;
  } catch (err) {
    console.warn(`[PeakCam] SNODAS fetch failed for ${resort.slug}:`, err);
    return null;
  }
}
