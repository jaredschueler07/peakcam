# Auth UI & Favorites — Antigravity Test Plan

## Target
PeakCam dev site at `http://localhost:3000` (or Vercel preview URL if deployed).

## Context
We added a full auth page (`/auth`) with email+password sign-in/sign-up, updated the header to link to it, wired favorites to prompt auth, and updated error handling on the auth callback. The favorites feature (heart button, `/favorites` page) was built in a prior sprint but was previously unusable because there was no login UI.

---

## Test 1: Header — Unauthenticated State

1. Navigate to `http://localhost:3000`
2. **Verify** the header contains these nav links: Resorts, Map, Compare, Snow Report, About
3. **Verify** "Favorites" link is **NOT visible** in the nav (it's auth-gated)
4. **Verify** a "Sign in" button/link appears on the right side of the header
5. **Verify** the "Sign in" link has `text-cyan` styling (bright cyan text with a subtle border)
6. Click the "Sign in" link
7. **Verify** you are navigated to `/auth` (not a modal — a full page)
8. **Verify** the URL includes `?next=%2F` (or the path you were on), so you'll be redirected back after login
9. Take a screenshot of the auth page

## Test 2: Auth Page — Sign In Form

1. Navigate to `/auth`
2. **Verify** the PeakCam logo ("PEAK" in white, "CAM" in cyan) is centered above the form
3. **Verify** there are two tabs: "Sign in" and "Sign up" — "Sign in" should be active by default
4. **Verify** the active tab has a `bg-surface` background with a border and shadow
5. **Verify** two input fields are visible: "Email address" and "Password"
6. **Verify** the email field has `placeholder="you@example.com"` and `autofocus`
7. **Verify** the password field has `placeholder="Your password"` for sign-in mode
8. **Verify** the submit button says "Sign in" and is **disabled** (muted styling) when fields are empty
9. Type "test@example.com" in the email field
10. Type "password123" in the password field
11. **Verify** the submit button is now **enabled** (cyan styling with hover effect)
12. **Verify** the footer text says "By signing in, you agree to our terms of use" with "terms of use" linking to `/about`
13. Take a screenshot of the filled form

## Test 3: Auth Page — Sign Up Mode

1. On the `/auth` page, click the "Sign up" tab
2. **Verify** the tab styling switches — "Sign up" is now active (bg-surface), "Sign in" is muted
3. **Verify** the password placeholder changes to "Min. 6 characters"
4. **Verify** the submit button text changes to "Create account"
5. **Verify** `autocomplete="new-password"` is set on the password field
6. Take a screenshot of the sign-up form

## Test 4: Auth Page — Error Handling

1. Navigate to `/auth?error=auth_failed`
2. **Verify** an error message appears: "Sign-in link expired or invalid. Please try again."
3. **Verify** the error text has `text-poor` styling (red/error color)
4. Take a screenshot showing the error state

## Test 5: Auth Page — Sign In Attempt (Invalid Credentials)

1. Navigate to `/auth`
2. Enter email "fake@notreal.com" and password "wrongpassword"
3. Click "Sign in"
4. **Verify** the button text changes to "Signing in..." while loading
5. **Verify** an error message appears (from Supabase — likely "Invalid login credentials")
6. **Verify** the form is still usable after the error (not stuck in loading state)
7. Take a screenshot of the error state

## Test 6: Auth Page — Sign Up Attempt

1. Navigate to `/auth`
2. Switch to "Sign up" tab
3. Enter a test email and password (min 6 characters)
4. Click "Create account"
5. **Verify** the button text changes to "Creating account..." while loading
6. **If signup succeeds**: verify the confirmation screen appears with:
   - An email icon in a cyan circle
   - "Check your email" heading
   - The email address you entered displayed in the message
   - A "Back to sign in" link
7. Take a screenshot of the confirmation screen

## Test 7: Favorites Page — Unauthenticated

1. Navigate to `/favorites` directly (while NOT signed in)
2. **Verify** the page heading is "MY FAVORITES"
3. **Verify** the subheading is "Quick access to your saved resorts"
4. **Verify** the unauthenticated state shows:
   - A heart icon in an alpenglow/orange-tinted circle
   - "Sign in to save favorites" heading
   - "Bookmark your go-to resorts and check conditions at a glance." description
   - A "Sign in" button/link that goes to `/auth?next=/favorites`
5. Click the "Sign in" button
6. **Verify** you land on `/auth?next=%2Ffavorites`
7. Take a screenshot of the unauthenticated favorites page

## Test 8: Browse Page — Resort Cards with Favorite Hearts

1. Navigate to `/` (browse page)
2. Scroll to the resort card grid
3. **Verify** resort cards render with: resort name, state badge, base depth number, 24h/48h snow, runs count, condition badge, camera count
4. Look for heart icons on the resort cards (bottom-right of each card, near the camera count)
5. Click a heart icon on any resort card
6. **If not signed in**: an AuthModal overlay should appear with the magic link sign-in form
7. **Verify** the AuthModal has:
   - "Sign In" heading
   - "to submit a conditions report" subheading
   - Email input
   - "Send Magic Link" button
   - Close (X) button in the top-right
8. Close the modal
9. Take a screenshot of the resort card grid showing the heart buttons

## Test 9: Auth Callback — Error Redirect

1. Navigate to `/auth/callback` (no code parameter)
2. **Verify** you are redirected to `/auth?error=auth_failed`
3. **Verify** the error message "Sign-in link expired or invalid. Please try again." is displayed

## Test 10: Navigation Flow — Full Happy Path (if test account available)

> If you have test credentials (email + password), run this flow:

1. Navigate to `/`
2. **Verify** "Favorites" is NOT in the nav
3. Click "Sign in" in the header
4. Enter test credentials on `/auth` and submit
5. **Verify** you are redirected back to `/` (the `next` param)
6. **Verify** "Favorites" NOW appears in the nav between "Snow Report" and "About"
7. **Verify** "Sign in" button is replaced by "Sign out" (with email in title attribute)
8. Click "Favorites" in the nav
9. **Verify** `/favorites` loads — shows either the empty state ("No favorites yet" with a muted heart icon and "Browse resorts" link) or your saved resorts
10. Navigate back to `/`, click a heart on a resort card
11. **Verify** the heart fills in (alpenglow color, optimistic update — instant, no reload)
12. Navigate to `/favorites`
13. **Verify** the favorited resort now appears in the grid
14. Click the heart on that resort to unfavorite
15. **Verify** it disappears from the grid and the empty state returns
16. Click "Sign out" in the header
17. **Verify** you're logged out — "Sign in" reappears, "Favorites" disappears from nav
18. Take screenshots at each key transition

## Test 11: Responsive / Mobile (if viewport resizing is available)

1. Resize viewport to 375px wide (iPhone SE)
2. Navigate to `/auth`
3. **Verify** the form is centered, readable, and inputs are full-width
4. **Verify** the sign-in/sign-up tabs are evenly split
5. Navigate to `/favorites`
6. **Verify** the unauthenticated state stacks vertically and is centered
7. Take screenshots at mobile viewport

## Test 12: Auth Page — Keyboard Navigation & Accessibility

1. Navigate to `/auth`
2. **Verify** the email field has autofocus
3. Press Tab — focus should move to password field
4. Press Tab — focus should move to the submit button
5. Press Enter on the submit button — form should attempt submission
6. **Verify** all inputs have proper `<label>` elements with `htmlFor` attributes
7. **Verify** the form uses semantic `<form>` with `onSubmit`

---

## Summary of Expected Routes

| Route | Auth Required | Expected Behavior |
|-------|--------------|-------------------|
| `/auth` | No | Sign-in/sign-up page |
| `/auth?error=auth_failed` | No | Shows error message |
| `/auth?next=/favorites` | No | After login, redirects to /favorites |
| `/auth/callback?code=xxx` | No | Exchanges code for session, redirects |
| `/auth/callback` (no code) | No | Redirects to /auth?error=auth_failed |
| `/favorites` | No (but auth-gated content) | Shows sign-in prompt if not authed |
| `/` | No | Browse page, heart buttons on cards |

## Key Visual Assertions

- **Cyan accent** (`#22D3EE`) on: Sign in button, active tab, submit button (enabled), PEAKCAM logo accent
- **Alpenglow** (warm orange-red) on: favorited heart buttons
- **Dark theme** throughout — `bg-bg` background, `bg-surface` card backgrounds
- **220ms transitions** on all interactive elements
- **Border glow** on inputs when focused (`focus:border-cyan`)
