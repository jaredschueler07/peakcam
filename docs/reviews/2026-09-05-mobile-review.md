# PeakCam mobile and game controls review

Reviewed September 5, 2026, against public production and source at `45ca630`. Review workspace: `review/mobile-layout`. No application or production changes made; the separate snowing-now checkout was left untouched.

The strongest parts are the recognizable cream/topographic visual identity, useful camera previews, and straightforward resort cards. The main problem is mobile task completion: some game controls cannot be reached, useful mountain information appears too late, and camera framing can hide the scene users came to inspect.

## Priority findings

### 1. Game start is unreachable on a small phone — P1

At 320×568, **Start descent** begins at y=610.9 and ends around y=660. The fixed game container has `overflow-hidden`, and the poster has no scrolling region. The document stays 568px tall, so scrolling cannot reveal the button. The long resort heading also exceeds the available width. Landscape has the same vertical-space problem.

Make the start/pause content scrollable within the available height, shorten mobile onboarding, allow long headings to wrap, and keep Start reachable. Test short landscape heights as well as narrow widths.

Source: `components/drop-in/DropInGame.tsx:497`. Evidence: [320px start screen](mobile-evidence/game-poster-320.png).

### 2. Touch steering rejects the right side — P1

`TouchAdapter` explicitly rejects touches beyond 55% of the viewport width. Dragging works throughout the left portion of the game surface, rather than only inside the visible circle, but the hint does not explain this. There is no handedness preference.

**Recommendation: combine both suggestions.** Allow steering to begin anywhere on empty game canvas, and offer a saved “Steer with right thumb” / “Steer with left thumb” setting that places the action buttons on the opposite side. Mirror the layout, never the steering direction. Rightward input must continue to turn right.

Source: `lib/game/input/TouchAdapter.ts:10`.

### 3. Landscape removes touch action buttons — P1

The entire touch overlay uses `sm:hidden`. At 844×390 the Tuck control is hidden while Pause remains visible. A phone rotated sideways crosses the 640px breakpoint and loses its touch actions; keyboard hints replace parts of the mobile presentation.

Choose controls using touch capability and an explicit input preference, rather than viewport width. Keep them available on landscape phones and tablets. Width should determine placement, not whether an input method exists.

Source: `components/drop-in/input/TouchControls.tsx:12`. Landscape finding verified through DOM visibility; landscape screenshot capture was unreliable and is not used as evidence.

### 4. Live look can crop away the mountain — P1

Card previews use `object-cover` in a 16:9 container. The loaded Aspen Mountain panorama is **482×150**, displayed in a **385.3×215.7** box. Filling that box discards approximately **44.4% of its width**. This is a concrete explanation for some previews feeling too zoomed.

The shared image-feed renderer also uses `object-cover`, including in the expanded Live look dialog. Its impact depends on the feed's native aspect ratio. Aspen's expanded viewer is a third-party Roundshot iframe, so its internal zoom is a separate provider behavior; changing image CSS will not change that player.

Default to **Full frame** for camera images. Use a neutral matte around panoramas, move labels outside the image when necessary, and offer optional **Fill** only where useful. Preserve native aspect ratio in the expanded viewer when space allows. Remove the preview hover enlargement. Review third-party players individually for documented initial-view settings; avoid global iframe scaling or invented URL parameters. Keep Open original available.

Sources: `components/browse/CardCameraPreview.tsx:15`, `components/cam/CamEmbed.tsx:76`, `components/cam/CamLightbox.tsx:61`. Evidence: [camera dimensions](mobile-evidence/camera-framing.json).

### 5. Homepage conditions arrive too late — P2

At 390×844 the first resort card starts around **y=1615**. Even after See conditions jumps past the full-height hero, the first card starts around **y=751** in the viewport. Navigation, search/filter chrome, seasonal messaging, and promotion occupy most of the first useful screen. At 320×568 the first card starts around y=1394 on initial load.

Use a compact mobile hero, one navigation header, and search followed quickly by resort cards. Place the alert promotion after a few cards. Collapse secondary filter chrome while scrolling. Preserve the brand through typography and color rather than a full screen of introductory space.

Evidence: [homepage](mobile-evidence/home-390.png), [after See conditions](mobile-evidence/home-conditions-390.png).

### 6. Resort details overflow at 320px — P1

Breckenridge produces a **349px document width in a 320px viewport**. Its heading and adjacent favorite button cannot shrink/wrap sufficiently; the favorite button reaches x=349. The page also presents two favorite controls.

Give the heading a shrinkable container and wrapping, keep one clearly placed favorite action, and add quick access to Cameras / Conditions / Forecast on this long page. Four camera iframes were present in the detail DOM; profile their actual loading cost before deciding whether to defer more embeds.

Source: `components/resort/ResortDetailPage.tsx:370`. Evidence: [narrow resort page](mobile-evidence/resort-top-320.png).

### 7. Public powder-alert links lead to a 404 — P1

The footer links to `/alerts/manage`, but that route calls `notFound()` without an email management token. Following the generic link produces a 404.

Send public visitors to a signup flow or public alerts landing page; reserve tokenized management links for email recipients.

Sources: `components/home/PeakFooter.tsx:72`, `app/alerts/manage/page.tsx:26`. Evidence: [404](mobile-evidence/alerts-manage-390.png).

### 8. Comparison and filters need mobile-specific hierarchy — P2

Compare retains a roughly 140px sticky label column and 180px resort columns. At 390px, only one resort is comfortably visible, undermining side-by-side comparison. Horizontal scrolling is contained, but its purpose is not obvious. Default mobile comparison to two compact resort columns or metric sections with paired values; explain scrolling when more resorts are selected.

Snow report places 27 state/country chips ahead of the data. Its source already enlarges chips for coarse pointers, which improves targets but increases vertical space. Replace this wall of chips with a region picker and filter sheet. On the map, group secondary radar/satellite/season controls into a Layers sheet to leave more map visible.

Evidence: [compare](mobile-evidence/compare-390.png), [snow report](mobile-evidence/snow-report-390.png), [map](mobile-evidence/map-loaded-320.png).

### 9. Dialog and navigation behavior is inconsistent — P2

The camera viewer uses a native modal dialog, Escape handling, initial focus, and focus restoration: retain this pattern. The auth modal lacks dialog semantics and explicit focus/Escape handling. The filter sheet declares a dialog but has no modal/focus-management behavior in its implementation. Body scroll locking alone does not make a dialog accessible.

The mobile menu toggle lacks `aria-expanded` and `aria-controls`; its menu needs a short-height scrolling strategy and predictable dismissal/focus restoration. Reuse one tested modal/sheet primitive and one menu contract. Keep close actions reachable when browser chrome or the keyboard reduces height.

Sources: `components/auth/AuthModal.tsx`, `components/browse/BrowsePage.tsx:127`, `components/layout/Header.tsx:158`.

### 10. Readability and target sizing need a consistent baseline — P2

Critical game labels reach 9px, which is hard to read while steering. Several secondary site controls are 28–40px; the image-feed refresh button is approximately 19px. Audit spacing as well as dimensions. Set a product target of 44–48px minimum comfortable hit areas, with larger primary game actions, and use at least 12px secondary / 14px critical status text where practical.

The token pair cream-50 `#faf4e6` on alpen `#d9552f` measures **3.62:1**. This is insufficient for normal-sized text requiring 4.5:1, including enabled small auth/button labels that use this pair. Use the existing darker alpen token for those buttons or another verified text/fill pair. Large text has a different threshold.

WCAG 2.2 AA's target-size minimum is **24×24 CSS pixels, with exceptions including spacing**; 44–48px is our proposed comfort standard, not a blanket AA requirement. See [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

### 11. Account and dashboard journeys need touch-friendly language — P2

The auth page asks for a password while favoriting opens a magic-link modal. Consolidate the approach alongside the separate auth/email review. The empty dashboard describes clicking a star, dragging, and resizing, while favorites use hearts. Provide ordered mobile cards and button-based move-up/move-down alternatives for customization. Populated signed-in dashboard behavior was not exercised.

For nonessential dragging interactions such as rearranging a dashboard, provide a non-drag alternative; see [W3C dragging-movements guidance](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html). Analog game steering requires its own usability assessment rather than an automatic conformance conclusion.

## Proposed game interaction

- Start with a brief touch instruction: “Drag anywhere to steer. Use the buttons to brake, tuck, or jump.” Show a small steering indicator at the finger's starting point once dragging begins.
- Default to left-thumb steering and right-side actions for continuity; offer right-thumb steering on the start and pause screens. Save the preference on the device without requiring an account.
- Keep Brake, Jump, and Tuck in the opposite thumb zone. Move Trail and Restart into Pause so accidental contact cannot reset a run.
- Offer optional hold-left / hold-right buttons for people who dislike dragging itself. Treat this as a distinct control mode, not a substitute for fixing the existing touch area.
- Preserve simultaneous steering and action presses, pointer capture, and clearing input on release/cancel/pause. Test orientation and app backgrounding for stuck input. Tune the existing 64px steering travel and dead zone only after real-thumb testing.
- Keep the descent meter readable and reduce competing HUD labels. Avoid covering the skier with navigation prompts.

## Mobile design principles and delivery order

1. **Make the main task available immediately.** Conditions and cameras precede promotional content; Start and core game controls must always be reachable.
2. **Design for hands and capabilities.** Touch input survives rotation, controls have comfortable separation, and handedness changes placement without changing direction.
3. **Preserve information.** Fit camera frames, wrap resort names, and disclose horizontal scrolling rather than silently cutting content.
4. **Use progressive disclosure.** Put secondary filters, map layers, and game utilities in sheets or Pause.
5. **Make recovery predictable.** Consistent Back/Close, focus return, scrollable dialogs, useful error states, and one coherent login approach.

First fix game reachability/landscape/steering, camera framing, resort overflow, and the broken alerts link. Then simplify homepage and resort hierarchy. Follow with comparison/filter layouts and shared modal/navigation behavior. Finish with typography, targets, contrast, and signed-in dashboard polish.

## Validation coverage and limits

Reviewed production homepage, filters, auth modal/page, compare, Breckenridge detail, snow report, map, favorites, logged-out dashboard, alerts management entry, and game start/running/pause states. Captured viewport layouts at 390×844 and 320×568, landscape DOM behavior at 844×390, and auth at a reduced 390×420 height. Raw geometry is in [measurements.json](mobile-evidence/measurements.json).

These were browser viewport checks, not physical iOS/Android tests. Pointer capability was not changed by viewport resizing. Reduced height is not a real software-keyboard test. Landscape image capture returned invalid dimensions, so those captures are excluded from visual conclusions. Hidden accessibility map links are excluded from target-size findings. No emails were sent, personal account tokens opened, or production settings changed.

Before shipping fixes: test real Safari/iOS and Chrome/Android in both orientations, touch plus action simultaneously, both handedness modes, small screens and long titles, screen-reader focus, 200% text sizing, keyboard-open dialogs, safe areas, and slower mobile camera loading. Verify 16:9, 4:3, and panoramic feeds in both card and expanded views. Run the relevant input/direction tests so control changes preserve non-inverted steering.
