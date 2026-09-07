export class ReviewAccessError extends Error {
  constructor(readonly status: 401 | 403 | 503) { super(status === 401 ? "Sign in to continue." : status === 403 ? "Reviewer access required." : "The inbox is temporarily unavailable."); }
}
export async function authorizeReviewer(deps: { verifiedUserId(): Promise<string | null>; isReviewer(id: string): Promise<boolean> }): Promise<string> {
  const id = await deps.verifiedUserId();
  if (!id) throw new ReviewAccessError(401);
  if (!await deps.isReviewer(id)) throw new ReviewAccessError(403);
  return id;
}
