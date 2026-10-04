import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { query } from '../db.js'
import { ApiError } from '../errors.js'
import { requireAuth } from '../middleware/requireAuth.js'

const router = Router()

const toUser = (row) => ({ id: row.userId, username: row.username, role: row.roleName })

const USER_SQL = `SELECT u.user_id, u.username, u.password_hash, u.status, r.role_name
                  FROM app_user u JOIN role r USING (role_id)`

// Hash of a throwaway string, compared against when the username is unknown (flattens timing).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10)

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body ?? {}
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Username and password are required', {
        fields: ['username', 'password'].filter((f) => typeof req.body?.[f] !== 'string' || !req.body[f]),
      })
    }
    const [user] = await query(`${USER_SQL} WHERE u.username = $1`, [username])
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH)
    if (!user || !ok || user.status !== 'ACTIVE') {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Username or password is incorrect')
    }
    // Fresh session id on login (prevents session fixation).
    req.session.regenerate((err) => {
      if (err) return next(err)
      req.session.userId = user.userId
      req.session.save((saveErr) => (saveErr ? next(saveErr) : res.json({ user: toUser(user) })))
    })
  } catch (err) {
    next(err)
  }
})

router.post('/logout', requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err)
    res.clearCookie('connect.sid')
    res.status(204).end()
  })
})

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const [user] = await query(`${USER_SQL} WHERE u.user_id = $1`, [req.user.id])
    if (!user || user.status !== 'ACTIVE') {
      return req.session.destroy(() => next(new ApiError(401, 'UNAUTHENTICATED', 'Login required')))
    }
    res.json({ user: toUser(user) })
  } catch (err) {
    next(err)
  }
})

export default router
