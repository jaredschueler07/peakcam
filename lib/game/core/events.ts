export interface SimulationEvents {
  crashed: boolean;
  crashReason: "TREE" | "ROCK" | "LANDING" | null;
  landed: boolean;
  gatePassed: boolean;
  gateMissed: boolean;
  scoreDelta: number;
  comboChanged: boolean;
  trailChanged: boolean;
  reset: boolean;
  liftFinished: boolean;
}

export function createSimulationEvents(): SimulationEvents {
  return {
    crashed: false, crashReason: null, landed: false, gatePassed: false,
    gateMissed: false, scoreDelta: 0, comboChanged: false, trailChanged: false,
    reset: false, liftFinished: false,
  };
}

export function clearSimulationEvents(events: SimulationEvents): void {
  events.crashed = false; events.crashReason = null; events.landed = false;
  events.gatePassed = false; events.gateMissed = false; events.scoreDelta = 0;
  events.comboChanged = false; events.trailChanged = false; events.reset = false;
  events.liftFinished = false;
}
