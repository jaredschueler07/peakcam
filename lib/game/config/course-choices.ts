/** Small baked catalog sent by the route; no terrain decoding in the React shell. */
export interface CourseChoice {
  readonly index: number;
  readonly id: string;
  readonly name: string;
  readonly difficulty: string | null;
  readonly topElevationM: number;
  readonly bottomElevationM: number;
  readonly lengthM: number;
  readonly widthM: number;
}
