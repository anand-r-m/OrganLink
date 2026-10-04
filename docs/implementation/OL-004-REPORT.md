# OL-004 Report — Authentication and session

## Files changed
- `server/routes/auth.js` (new): `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- `server/middleware/requireAuth.js` (new): 401 `UNAUTHENTICATED` without a session; sets `req.user.id`.
- `server/index.js`: `express-session` (in-memory store, `connect.sid`, HttpOnly, SameSite=Lax), auth router, global `requireAuth` on `/api` after health and auth.
- `src/api/client.js` (new, minimal): `apiFetch`, `ApiError`, `USE_LIVE_API`.
- `src/context/AuthContext.jsx`: live mode uses the endpoints and restores login via `/me` on load (`isLoading`); mock mode unchanged (admin/admin + localStorage).
- `src/pages/LoginPage.jsx`: awaits async `login`; the same shake and error on bad credentials; "Unable to reach the server" on network or 5xx errors.
- `src/components/AppShell.jsx`: renders nothing while `/me` is loading (avoids a redirect flash on refresh).
- `tests/server/auth.test.js` (new), `package.json` / `package-lock.json` (added `express-session`; moved `bcryptjs` to dependencies), `.env.example` (`SESSION_SECRET`), `docs/implementation/LESSONS_LEARNED.md`.

## Behavior
- Login checks bcrypt against `app_user.password_hash`, rejects `INACTIVE` users, and returns 400 on missing fields. An unknown user still runs a dummy bcrypt compare. The session id is regenerated on login.
- Logout destroys the session, clears the cookie and returns 204 (401 if there is no session).
- `/me` re-reads the user, so a deactivated user's session stops working.
- `SESSION_SECRET` falls back to a dev default with a warning.

## Validation (throwaway local Postgres 18 on :5433, `db:reset -- --yes`; `.env` untouched)
- `npm run test:server`: 26/26 pass (9 new auth tests, covering the cookie flags, the 401/400 cases, the inactive user, the lifecycle and the guard).
- curl through the Vite proxy (`VITE_DATA_SOURCE=api`): me without cookie 401; bad login 401 `INVALID_CREDENTIALS`; login 200 with `HttpOnly; SameSite=Lax` cookie; me 200; logout 204; me 401; health 200.
- `npm run lint`: only existing warnings. `npm run build`: succeeds.

## Failures encountered
- Postgres would not start because the socket path was too long. Fixed with a short `-k` dir (see LESSONS_LEARNED).

## Risks / follow-ups
- The browser UI flow (shake animation, refresh persistence, redirect after logout) was **not exercised in a real browser**. It is covered only by the build and by the API checks above. A manual check with `VITE_DATA_SOURCE=api npm run dev` is advised.
- The in-memory store loses sessions on a server restart (by design) and the cookie is not `secure` (dev over HTTP).
- OL-005 will extend `src/api/client.js`; it currently has no notification handling.

## Acceptance criteria
- admin/admin returns 200 with the user and an httpOnly `connect.sid`: **satisfied**
- Wrong password returns 401 `INVALID_CREDENTIALS`; the login card shakes: **satisfied** (API tested; the shake path is unchanged code, not browser-verified)
- `/me` without a cookie returns 401 `UNAUTHENTICATED`; with a cookie it returns the user: **satisfied**
- After logout `/me` returns 401: **satisfied**
- Live-mode refresh stays logged in via `/me`: **implemented; the `/me` leg verified by curl, the browser refresh not verified**
- `requireAuth` on every `/api/*` route except login and health: **satisfied**
- Mock mode unchanged: **satisfied by code inspection (the same hardcoded path)**
