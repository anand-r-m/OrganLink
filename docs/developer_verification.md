# Developer Verification Utilities

Internal tools for verifying the OrganLink Phase 0 shared foundation. These artifacts are **maintained in the repository for developers** but are **not part of the product** defined in `ui_mastercontext.md` or `dev_split.md`.

Do not treat them as user-facing features, demo pages, or submission requirements.

---

## Overview

| Artifact | Location | Type |
|---|---|---|
| Smoke test page | `src/pages/Phase0SmokePage.jsx` | Application source |
| Smoke test route | `/__phase0-smoke` in `src/App.jsx` | Application route |
| Full verification driver | `.phase0-verify/verify.mjs` | Node script (Chrome CDP) |
| DOM probe script | `.phase0-verify/probe.mjs` | Node script (Chrome CDP) |
| Verification workspace | `.phase0-verify/` | Directory (scripts + generated outputs) |

**Generated outputs** (browser profiles, screenshots, logs) are gitignored. See `.gitignore` and the section below.

---

## Phase0SmokePage.jsx

### Purpose

In-app page that renders all four shared components (`StatCard`, `StatusBadge`, `FormModal`, `DataTable`) and imports every mock-data module. Confirms that components compile, styles apply, and data shapes load without runtime import errors.

### When to use

- After changing shared components in `src/components/`
- After changing mock-data field shapes in `src/data/`
- After upgrading Mantine, mantine-react-table, or related dependencies
- When onboarding and you want a quick visual check without building a feature page

### When NOT to use

- As a reference for product UX or page layout (use `ui_mastercontext.md` instead)
- As a substitute for testing your assigned page (`/dashboard`, `/donors`, etc.)
- In demos, screenshots, or hackathon submission materials
- To validate Dev 1/2/3 page functionality — it only exercises foundation pieces

### How to access

1. Run `npm run dev`
2. Log in with `admin` / `admin`
3. Navigate to `http://localhost:5173/__phase0-smoke`

---

## Route `/__phase0-smoke`

### Purpose

Protected route (inside `AppShell`) that mounts `Phase0SmokePage`. Exists solely so the smoke page is reachable during development without adding it to the product sidebar.

### When to use

Same as `Phase0SmokePage.jsx` — navigate here manually when you need the in-app smoke check.

### When NOT to use

- Do not add a sidebar link or breadcrumb entry for this route
- Do not document it in user-facing materials or the product route map in `ui_mastercontext.md` Section 6
- Do not build feature logic that depends on this route

---

## verify.mjs

### Purpose

Automated end-to-end verification script using headless Chrome over the Chrome DevTools Protocol (CDP). Runs ten checks:

1. Unauthenticated redirect to `/login`
2. Login form content
3. Invalid credentials + Enter key submission
4. Successful login and AppShell render
5. All eight sidebar routes (URL, breadcrumb, heading)
6. Shared components and mock data on `/__phase0-smoke`
7. FormModal open/close behavior
8. Session persistence across reload
9. Logout and protected-route redirect
10. Unknown route redirect

Writes PNG screenshots to `.phase0-verify/shots/` and prints PASS/FAIL per check.

### When to use

- After auth, routing, or AppShell changes
- Before merging foundation or shared-component work
- When debugging regressions in login/logout or sidebar navigation
- When you need reproducible verification beyond manual clicking

### When NOT to use

- In CI/CD unless Chrome CDP is explicitly set up (not configured by default)
- As a replacement for `npm run build` (build verification is separate)
- To test page-specific features (Dashboard charts, Donor CRUD, etc.)
- On production or staging URLs — defaults to `http://localhost:5173`

### Prerequisites

- Dev server running: `npm run dev`
- Google Chrome installed (macOS path used in typical setup)
- Headless Chrome listening on CDP port `9222`

### Example workflow

```bash
# Terminal 1
npm run dev

# Terminal 2 — launch Chrome with CDP (example)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --remote-debugging-port=9222 \
  --user-data-dir="$PWD/.phase0-verify/profile" about:blank

# Terminal 3
node .phase0-verify/verify.mjs
```

Exit code `0` = all checks passed; non-zero = one or more failures.

---

## probe.mjs

### Purpose

Lightweight CDP diagnostic script for inspecting a single behavior (e.g. DataTable pagination DOM, FormModal mount timing). Used when `verify.mjs` fails or when investigating headless Chrome animation/timing issues.

### When to use

- Debugging a specific failing check from `verify.mjs`
- Inspecting DOM structure or computed styles after a component change
- Prototyping a new automated assertion before adding it to `verify.mjs`

### When NOT to use

- As the primary verification entry point (prefer `verify.mjs` for full suite)
- In production workflows
- Without understanding that script contents may change between debugging sessions

### Prerequisites

Same as `verify.mjs`: dev server, Chrome on port `9222`, authenticated session (script may set `localStorage` directly).

```bash
node .phase0-verify/probe.mjs
```

---

## `.phase0-verify/` directory

### Purpose

Workspace for verification scripts and their **generated** outputs.

| Path | Tracked in git | Description |
|---|---|---|
| `verify.mjs` | Yes | Full verification driver |
| `probe.mjs` | Yes | Diagnostic probe |
| `profile/` | **No** (gitignored) | Ephemeral Chrome user-data directory |
| `shots/` | **No** (gitignored) | PNG screenshots from `verify.mjs` |
| `chrome.log` | **No** (gitignored) | Chrome stderr/stdout log from manual launches |

### When to use

Keep scripts in version control. Let generated folders be recreated locally as needed.

### When NOT to use

- Do not commit `profile/`, `shots/`, or `chrome.log`
- Do not treat contents of `profile/` as project configuration
- Do not copy browser profile data into other environments

---

## Relationship to product documentation

| Document | Covers verification tools? |
|---|---|
| `ui_mastercontext.md` | No — product routes and pages only |
| `dev_split.md` | No — sprint tasks only |
| `docs/foundation_handoff.md` | Brief pointer to this file |
| `docs/foundation_notes.md` | Records verification results from Phase 0 implementation |
| `docs/developer_verification.md` | **Yes** — this file |

---

## Quick decision guide

**Use verification tools when:**

- You changed foundation code (auth, shell, shared components, mock data, global CSS)
- You need confidence before pushing shared work that other devs depend on

**Do not use verification tools when:**

- You are implementing or testing a product page assigned to Dev 1, 2, or 3
- You are preparing demo or submission materials
- You assume `/__phase0-smoke` is a documented product route — it is not

**Always run for any change:**

```bash
npm run build
```

Use the utilities in this document when foundation-level runtime behavior also needs checking.
