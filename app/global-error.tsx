"use client";

import { useEffect } from "react";

/**
 * Last-resort root boundary when `app/layout.tsx` or `ClientProviders` throws.
 * Must define its own `<html>` / `<body>` and keep dependencies minimal so a
 * root stylesheet or router failure cannot cascade.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[PeakCam] root layout failed:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          backgroundColor: "#f1e7cf",
          color: "#2a1f14",
          fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem 1rem",
        }}
      >
        <main
          style={{
            width: "100%",
            maxWidth: "32rem",
            backgroundColor: "#faf4e6",
            border: "1.5px solid #2a1f14",
            borderRadius: "18px",
            boxShadow: "3px 3px 0 #2a1f14",
            padding: "2rem",
          }}
        >
          <p
            style={{
              margin: 0,
              fontFamily: "ui-monospace, monospace",
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#63482d",
            }}
          >
            PeakCam
          </p>
          <h1 style={{ margin: "0.5rem 0 0", fontSize: "1.875rem", fontWeight: 900, lineHeight: 1.05 }}>
            We couldn&rsquo;t load this <em style={{ color: "#d9552f" }}>page</em>.
          </h1>
          <p style={{ margin: "0.75rem 0 0", fontSize: "0.9375rem", lineHeight: 1.5, color: "#63482d" }}>
            Something unexpected happened before the page finished loading. Try again or return to the resort directory.
          </p>
          <div style={{ marginTop: "1.5rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                minHeight: "44px",
                padding: "0.625rem 1.25rem",
                borderRadius: "9999px",
                border: "1.5px solid #2a1f14",
                backgroundColor: "#a93f20",
                color: "#faf4e6",
                fontWeight: 700,
                fontSize: "0.875rem",
                cursor: "pointer",
                boxShadow: "2px 2px 0 #2a1f14",
              }}
            >
              Try again
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                minHeight: "44px",
                display: "inline-flex",
                alignItems: "center",
                padding: "0 0.5rem",
                color: "#2a1f14",
                fontWeight: 600,
                fontSize: "0.875rem",
                textDecoration: "underline",
              }}
            >
              Back to resorts
            </a>
          </div>
          {error.digest && (
            <p
              style={{
                marginTop: "1.5rem",
                paddingTop: "1rem",
                borderTop: "1px dashed rgba(99, 72, 45, 0.4)",
                fontFamily: "ui-monospace, monospace",
                fontSize: "11px",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: "#63482d",
              }}
            >
              Reference {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
