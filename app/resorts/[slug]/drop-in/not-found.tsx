import { Header } from "@/components/layout/Header";
import DropInUnavailable from "@/components/drop-in/DropInUnavailable";

/**
 * The 404 boundary for the per-resort Drop In route.
 *
 * Without it, `notFound()` from this route fell through to the resort-level
 * boundary, which announces "RESORT NOT FOUND" — wrong for everyone who typed a
 * real resort into a Drop In URL. The page now resolves the slug first and only
 * throws to this boundary when the resort genuinely doesn't exist, so the copy
 * here can stay honest without knowing the slug (not-found.tsx gets no params).
 */
export default function DropInNotFound() {
  return (
    <>
      <Header showSearch={false} />
      <main id="main-content">
        <DropInUnavailable />
      </main>
    </>
  );
}
