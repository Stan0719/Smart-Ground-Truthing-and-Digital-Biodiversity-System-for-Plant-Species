// Server-only: never serialize this result into an authentication response.
export async function resolveReviewIdentity(auth, token) {
  const session = typeof token === 'string' && token ? await auth.session(token) : null
  if (!session) return { status: 401, error: 'Please sign in again.' }
  // Read the staff record again rather than accepting a public user or request body.
  const staff = await auth.db.prepare('SELECT * FROM users WHERE id=?').get(session.id)
  if (
    !staff ||
    staff.role !== 'Conservation Officer' ||
    staff.status !== 'Active' ||
    staff.must_change_password
  )
    return {
      status: 403,
      error: 'An active Conservation Officer account with a permanent password is required.',
    }
  if (!Number.isSafeInteger(staff.postgres_user_id) || staff.postgres_user_id <= 0)
    return {
      status: 403,
      error: 'Your reviewer identity has not been configured. Contact the administrator.',
    }
  return { userId: staff.id, verifiedBy: staff.postgres_user_id }
}
export function validateReviewInput(body) {
  const decisions = ['Approved', 'Rejected', 'Correction Required', 'Flagged']
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !['decision', 'comment'].includes(key)) ||
    !decisions.includes(body.decision) ||
    typeof body.comment !== 'string' ||
    body.comment.length > 5000
  )
    return {
      status: 400,
      error: 'Send only a valid decision and a comment of at most 5000 characters.',
    }
  return { decision: body.decision, comment: body.comment }
}
