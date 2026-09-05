/** Renderer/runtime instrumentation only. No DOM import enters the deterministic core. */
export interface DropInDebugApi {
  snapshot(): unknown;
  setQuality(rung: number | null): void;
  selectRun(index: number): void;
  spawnAtLift(index: number): void;
  stepTicks(count: number, input?: { steer?: number; tuck?: number; brake?: number; jumpHeld?: boolean }): void;
  resume(): void;
}
interface DebugHost { __dropInDebug?: DropInDebugApi }
export function installE2eDebug(host: DebugHost, search: string, create: () => DropInDebugApi): (() => void) | undefined {
  if (new URLSearchParams(search).get("e2edebug") !== "1") return undefined;
  const api = create();
  host.__dropInDebug = api;
  return () => { if (host.__dropInDebug === api) delete host.__dropInDebug; };
}
