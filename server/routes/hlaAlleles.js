import { Router } from 'express'
import { query, withTx } from '../db.js'
import { ApiError } from '../errors.js'
import { toCamelRows } from '../util/case.js'
import { checkShape, paramId } from '../util/settingsSql.js'

const router = Router()

const HLA_SQL = 'SELECT allele_id AS id, locus, allele_name FROM hla_allele'
const LOCI = ['A', 'B', 'DRB1']

// GET /api/hla-alleles?locus=A|B|DRB1
router.get('/', async (req, res, next) => {
  try {
    const { locus } = req.query
    if (locus !== undefined && !LOCI.includes(locus)) {
      throw new ApiError(400, 'VALIDATION_ERROR', `locus must be one of ${LOCI.join(', ')}`, { fields: ['locus'] })
    }
    const rows =
      locus === undefined
        ? await query(`${HLA_SQL} ORDER BY locus, allele_name`)
        : await query(`${HLA_SQL} WHERE locus = $1 ORDER BY allele_name`, [locus])
    res.json(toCamelRows(rows))
  } catch (err) {
    next(err)
  }
})

// POST /api/hla-alleles: the DB CHECK validates the locus, the unique index rejects duplicates.
router.post('/', async (req, res, next) => {
  try {
    checkShape(req.body, { locus: 'string', alleleName: 'string' })
    const missing = ['locus', 'alleleName'].filter((f) => req.body[f] === undefined)
    if (missing.length) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Missing fields: ${missing.join(', ')}`, { fields: missing })
    }
    const row = await withTx(req.session.userId, async (client) => {
      const { rows } = await client.query(
        'INSERT INTO hla_allele (locus, allele_name) VALUES ($1, $2) RETURNING allele_id AS id, locus, allele_name',
        [req.body.locus, req.body.alleleName.trim()],
      )
      return toCamelRows(rows)[0]
    })
    res.status(201).json(row)
  } catch (err) {
    next(err)
  }
})

// DELETE /api/hla-alleles/:id: FK RESTRICT from donor_hla / recipient_hla yields 409 REFERENCE_IN_USE.
router.delete('/:id', async (req, res, next) => {
  try {
    const id = paramId(req.params.id)
    const notFound = new ApiError(404, 'HLA_ALLELE_NOT_FOUND', `HLA allele ${req.params.id} not found`)
    if (id === null) throw notFound
    await withTx(req.session.userId, async (client) => {
      const del = await client.query('DELETE FROM hla_allele WHERE allele_id = $1', [id])
      if (del.rowCount === 0) throw notFound
    })
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

export default router
