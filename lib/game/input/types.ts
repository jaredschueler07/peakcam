export type { InputFrame } from "../core/types";

export type AnalogSource = "pointer" | "touch" | "gamepad";
export type DigitalSource = "keyboard" | "gamepad";
export type InputAction = "jump" | "tuck" | "brake" | "restart" | "trail" | "pause" | "lift" |
  "weather1" | "weather2" | "weather3" | "weatherCycle";
export type ControlScheme = AnalogSource | DigitalSource;

export interface InputAdapter {
  setActive(active: boolean): void;
  clear(): void;
  dispose(): void;
}
