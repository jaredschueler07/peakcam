# Mobile behavior contract

Target: the production build of this branch at http://127.0.0.1:3116 (later the verified deployment URL). Start logged out. Do not send emails or use real account credentials. Synthetic account/network fixtures are permitted only for account-form and dashboard persistence checks.

1. At 320×568 and 390×844, the homepage shows the first camera preview within 650px of the document top. Search, filters and navigation remain usable. There is no unintended horizontal page scrolling.
2. Filters, auth, map layers and alerts dialogs contain interaction, close with Escape or their visible close control, and restore focus to their opener. Reduced viewport height still permits reaching their actions.
3. A long-name resort fits 320px. Its Cameras/Conditions/Forecast links navigate to the named section. Video iframes load after selecting a camera rather than all starting on entry.
4. Panoramic camera images show the full frame by default. Expanded image feeds can switch to Fill and back. Opening/switching/closing Live look preserves the existing single-feed lifecycle.
5. Two resorts can be compared on a phone without losing either value column. More than two remain reachable with an explicit scrolling cue. Snow report has a region picker; secondary map controls live in Layers.
6. The game can be started and paused on a short portrait or landscape viewport. Hand and steering preferences persist on reload. Both thumb layouts retain the same left/right steering direction.
7. Drag steering can begin on either empty side of the canvas. Button steering is optional. Landscape touch controls remain visible. Steering and action buttons can be held simultaneously; release/cancel/pause clears the relevant inputs. Restart and Trail are available in Pause, away from primary touch actions.
8. The descent meter remains visible and readable with touch controls. Canvas rendering, score/run lifecycle, keyboard controls, audio, and existing camera behavior continue to work.
9. The public footer alerts link leads to signup without a token. Account page and favorite dialog share sign-in/signup/password recovery/email-link options. Invalid requests show errors; recovery does not assert an account exists. Unauthenticated visitors cannot update a password.
10. A populated mobile dashboard uses ordered cards with working Move up/down controls. Changes are persisted and remain in the requested order after finishing editing. Desktop users can choose list or grid.

Probes: small/large phone, short landscape, reload preferences, both hands, simultaneous touch input, Escape/Tab/focus return, long labels, 200% text, failed thumbnail, empty account input, synthetic recovery response, synthetic dashboard saves, camera open/switch/close.

Evidence: screenshots, observable DOM geometry, interaction results, and request summaries with no credentials. Browser emulation is not a claim of physical-device testing. Email delivery/inbox reputation, provider-controlled optical/interactive-camera zoom, and changes to SMTP or database policy are outside this mobile implementation contract.
