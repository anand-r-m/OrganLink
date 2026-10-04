// Error translation (API_CONTRACT "Error codes") and the Express error middleware.

export class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

const CHECK_MESSAGES = {
  ck_donor_death_fields: 'Deceased donors need a death date; living donors must not have death details',
  ck_donor_death_after_birth: 'Death date must be after date of birth',
  ck_organ_not_future: 'Recovery time cannot be in the future',
  ck_organ_discard_reason: 'A discard reason is required to discard an organ',
  ck_waitlist_not_future: 'Listing date cannot be in the future',
  ck_region_weights_nonzero: 'At least one policy weight must be greater than zero',
  ck_organ_type_ratio_order: 'Maximum weight ratio must exceed the minimum',
  ck_transport_time_order: 'Arrival cannot precede departure',
}

const withConstraint = (e) => (e.constraint ? { constraint: e.constraint } : {})

// Map a thrown error to an ApiError. ApiErrors pass through; unknown errors become 500 INTERNAL.
export function translatePgError(e) {
  if (e instanceof ApiError) return e

  switch (e?.code) {
    case '22P02':
      return new ApiError(400, 'VALIDATION_ERROR', e.message, {})
    case '23502':
      return new ApiError(400, 'VALIDATION_ERROR', e.message, e.column ? { fields: [e.column] } : {})
    case '23503':
      // DELETE reports the referencing table via "is still referenced"; INSERT/UPDATE via "is not present".
      if (/is still referenced/.test(e.message ?? '')) {
        return new ApiError(
          409,
          'REFERENCE_IN_USE',
          'This record is referenced by other data and cannot be deleted',
          withConstraint(e),
        )
      }
      return new ApiError(400, 'REFERENCE_NOT_FOUND', 'Referenced record does not exist', withConstraint(e))
    case '23514':
      return new ApiError(
        400,
        'CONSTRAINT_VIOLATION',
        CHECK_MESSAGES[e.constraint] ?? `Value violates constraint ${e.constraint}`,
        withConstraint(e),
      )
    case '23505':
      switch (e.constraint) {
        case 'ux_offer_active':
          return new ApiError(409, 'ACTIVE_OFFER_EXISTS', 'This organ already has an active offer')
        case 'ux_offer_no_reoffer':
          return new ApiError(
            409,
            'RECIPIENT_ALREADY_DECLINED',
            'This recipient has already declined this organ',
          )
        case 'transplant_event_offer_id_key':
          return new ApiError(
            409,
            'TRANSPLANT_ALREADY_RECORDED',
            'A transplant is already recorded for this offer',
          )
        default:
          return new ApiError(409, 'DUPLICATE', 'A record with these values already exists', withConstraint(e))
      }
    case '40001':
    case '40P01':
      return new ApiError(409, 'CONFLICT_RETRY', 'Conflicting update, please retry')
    case 'P0001':
      // Raised by a trigger or function: the message is the business rule, verbatim.
      return new ApiError(422, 'RULE_VIOLATION', e.message)
    default:
      return new ApiError(500, 'INTERNAL', 'Unexpected server error')
  }
}

// Express error middleware: always responds with {error:{code,message,details}}.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  // Malformed JSON body from express.json().
  if (err?.type === 'entity.parse.failed') {
    err = new ApiError(400, 'VALIDATION_ERROR', 'Request body is not valid JSON')
  }
  const apiErr = translatePgError(err)
  if (apiErr.status === 500) {
    console.error('[error]', err?.stack ?? err) // stack stays in the server log only
  }
  if (res.headersSent) return res.end()
  res.status(apiErr.status).json({
    error: { code: apiErr.code, message: apiErr.message, details: apiErr.details ?? {} },
  })
}
