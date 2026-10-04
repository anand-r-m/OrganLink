import { ApiError } from '../errors.js'

// Rejects requests without a logged-in session; exposes req.user.id for withTx.
export function requireAuth(req, _res, next) {
  const userId = req.session?.userId
  if (!userId) return next(new ApiError(401, 'UNAUTHENTICATED', 'Login required'))
  req.user = { id: userId }
  next()
}
