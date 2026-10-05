"use client";

/** Move keyboard focus as well as the viewport when skipping navigation. */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      onClick={(event) => {
        const main = document.getElementById("main-content");
        if (!main) return;
        event.preventDefault();
        // Main landmarks are not focusable by default. A negative tab index
        // permits this jump without adding a stop to the normal tab order.
        if (!main.hasAttribute("tabindex")) main.tabIndex = -1;
        main.focus({ preventScroll: true });
        main.scrollIntoView({ block: "start" });
      }}
      className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100]
                 focus:px-4 focus:py-2 focus:bg-forest focus:text-cream-50 focus:rounded-full focus:text-sm focus:font-semibold focus:shadow-stamp"
    >
      Skip to main content
    </a>
  );
}
