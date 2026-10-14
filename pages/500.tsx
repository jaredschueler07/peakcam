import Link from "next/link";
import Head from "next/head";

/**
 * Static Pages Router fallback used by Vercel's Node middleware when it needs
 * `.next/server/pages/500.html`. The App Router `app/error.tsx` handles normal
 * route-segment errors, but it does not create this Pages Router artifact.
 * Keep the markup small and inline-styled so it is usable as the framework's
 * last-resort error document.
 */
export default function ServerErrorPage() {
  return (
    <>
      <Head><title>Temporarily unavailable | PeakCam</title></Head>
      <main
        style={{
          boxSizing: "border-box",
          minHeight: "100vh",
          display: "grid",
          placeContent: "center",
          gap: "1rem",
          padding: "2rem",
          background: "#f1e7cf",
          color: "#2a1f14",
          fontFamily: "system-ui, sans-serif",
          lineHeight: 1.5,
        }}
      >
        <p style={{ margin: 0, fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase" }}>
          PeakCam · 500
        </p>
        <h1 style={{ maxWidth: "34rem", margin: 0, fontSize: "clamp(2rem, 6vw, 3.5rem)", lineHeight: 1.05 }}>
          We couldn’t load this page.
        </h1>
        <p style={{ maxWidth: "34rem", margin: 0, color: "#63482d" }}>
          The resort catalog is temporarily unavailable. Please try again in a moment.
        </p>
        <Link href="/" style={{ width: "fit-content", color: "#2a1f14", fontWeight: 700 }}>
          Back to PeakCam
        </Link>
      </main>
    </>
  );
}
