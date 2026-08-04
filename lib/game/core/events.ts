export interface SimulationEvents {
  jumped: boolean;
  crashed: boolean;
  crashReason: "TREE" | "ROCK" | "LANDING" | null;
  landed: boolean;
  landingKind: "soft" | "hard" | null;
  trickLanded: boolean;
  gatePassed: boolean;
  gateMissed: boolean;
  scoreDelta: number;
  comboChanged: boolean;
  trailChanged: boolean;
  reset: boolean;
  liftFinished: boolean;
  finished: boolean;
}

export function createSimulationEvents(): SimulationEvents {
  return {
    jumped: false, crashed: false, crashReason: null, landed: false,
    landingKind: null, trickLanded: false, gatePassed: false,
    gateMissed: false, scoreDelta: 0, comboChanged: false, trailChanged: false,
    reset: false, liftFinished: false, finished: false,
  };
}

export function clearSimulationEvents(events: SimulationEvents): void {
  events.jumped = false; events.crashed = false; events.crashReason = null; events.landed = false;
  events.landingKind = null; events.trickLanded = false;
  events.gatePassed = false; events.gateMissed = false; events.scoreDelta = 0;
  events.comboChanged = false; events.trailChanged = false; events.reset = false;
  events.liftFinished = false; events.finished = false;
}
