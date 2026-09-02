/**
 * scripts/lib/snow-sync-driver.ts
 * ───────────────────────────────
 * The loop both snow syncs share.
 *
 * scripts/snotel-sync.ts and scripts/model-sync.ts walked the same skeleton:
 * fetch the resort list → per-resort try/catch → tally ok / no-data / failed →
 * sleep between resorts → print a summary → install a fatal handler that
 * exits 1. Only the per-resort body genuinely differs (NRCS AWDB readings run
 * through the QC in lib/snow-quality.ts vs. an Open-Meteo snapshot), so that
 * stays with each script and is passed in as `syncResort`.
 *
 * Log output is load-bearing: launchd writes it to a file a human reads. The
 * exact line shapes of both scripts are preserved — callers supply the two
 * header lines and the per-resort line, the driver owns SKIP/FAIL tallying
 * and the "Done." summary.
 */

/** Minimum a resort row must carry for the driver to log and tally it. */
export interface SyncResort {
  id: string;
  name: string;
}

/**
 * What one resort's sync produced.
 * - `ok`   → counted as synced
 * - `skip` → counted as "no data" (upstream returned nothing)
 * A thrown error is counted as failed; the driver logs it and continues.
 */
export interface ResortOutcome {
  status: "ok" | "skip";
  /** The full line to print, including its leading indent. */
  log: string;
}

export interface SnowSyncResult {
  total: number;
  success: number;
  noData: number;
  failed: number;
}

export interface SnowSyncOptions<R extends SyncResort> {
  /** Bracketed log prefix, e.g. `snotel-sync`. */
  label: string;
  /** First line, printed as `[label] <startLine>` followed by a blank line. */
  startLine: string;
  /** Second line, printed as `[label] <foundLine(n)>` followed by a blank line. */
  foundLine: (count: number) => string;
  fetchResorts: () => Promise<R[]>;
  syncResort: (resort: R) => Promise<ResortOutcome>;
  /** Rate limit between resorts. Both scripts use 300ms. */
  delayMs?: number;
  /** Injectable for tests, so the suite does not actually wait. */
  sleepFn?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
  errorLog?: (msg: string) => void;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runSnowSync<R extends SyncResort>(
  opts: SnowSyncOptions<R>,
): Promise<SnowSyncResult> {
  const {
    label,
    startLine,
    foundLine,
    fetchResorts,
    syncResort,
    delayMs = 300,
    sleepFn = sleep,
    log = console.log,
    errorLog = console.error,
  } = opts;

  log(`[${label}] ${startLine}\n`);

  const resorts = await fetchResorts();
  log(`[${label}] ${foundLine(resorts.length)}\n`);

  let success = 0;
  let failed = 0;
  let noData = 0;

  for (const resort of resorts) {
    try {
      const outcome = await syncResort(resort);
      log(outcome.log);
      if (outcome.status === "ok") success++;
      else noData++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errorLog(`  FAIL ${resort.name} — ${msg}`);
      failed++;
    }

    await sleepFn(delayMs);
  }

  log(
    `\n[${label}] Done. ${success} synced, ${noData} no data, ${failed} failed (of ${resorts.length} total)`,
  );

  return { total: resorts.length, success, noData, failed };
}

/**
 * Shared entry point: run `main`, print `[label] Fatal: …` and exit 1 on a
 * rejection. `includeStack` reproduces pipeline-backfill.ts's stack-preferring
 * variant.
 */
export function runScript(
  label: string,
  main: () => Promise<unknown>,
  opts: { includeStack?: boolean } = {},
): void {
  main().catch((err) => {
    const detail =
      err instanceof Error
        ? opts.includeStack
          ? (err.stack ?? err.message)
          : err.message
        : err;
    console.error(`[${label}] Fatal:`, detail);
    process.exit(1);
  });
}
