import { Pool } from 'pg';
import { getCoordinatorByEmail, getCoordinatorPinHash } from '@cis/db';
import { verifyPassword } from '@cis/auth';
import type { FirmCoordinator } from '@cis/shared-types';
import { DomainError } from './errors';

/**
 * Coordinator authentication — the engineering requirement `UX-FRM-007` itself
 * leaves open ("Any six digits are accepted as a PIN. Verification, lockout
 * and reuse rules are engineering concerns."). The one fixed design decision
 * is not reinvented here: email plus PIN, never a username/password account.
 *
 * A coordinator token is issued by the API layer with a distinct claim
 * (`kind: 'coordinator'`) from an operator session, resolving to
 * `firm_coordinators.id` — never to `users.id`. Coordinators are a
 * structurally separate identity space from operators on this platform, the
 * same way a respondent is; this keeps that separation true for sign-in too.
 */
export class CoordinatorAuthError extends DomainError {
  constructor(message: string, code = 'COORDINATOR_AUTH') {
    super(message, code);
  }
}

/** Invalid email/PIN combination, or the coordinator has been revoked. Never
 *  distinguishes "no such email" from "wrong PIN" — the same anti-enumeration
 *  discipline as operator login. */
export class InvalidCoordinatorCredentialsError extends CoordinatorAuthError {
  constructor() {
    super('Invalid email or PIN', 'INVALID_CREDENTIALS');
  }
}

/** A valid-shaped argon2id hash to verify against when no coordinator matches
 *  the email, so the response takes the same shape of work either way — the
 *  same anti-enumeration technique operator login already uses by always
 *  calling verifyPassword regardless of whether a user was found. */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo';

/**
 * Verify a coordinator's email + PIN. Returns the coordinator on success.
 * Revoked coordinators can never sign in, even with the correct PIN — a
 * removed coordinator's access ends immediately (`UX-FRM-007`), and a
 * coordinator with no PIN set yet (claim in progress) cannot sign in either.
 */
export async function coordinatorLogin(
  pool: Pool,
  input: { email: string; pin: string },
): Promise<FirmCoordinator> {
  const coordinator = await getCoordinatorByEmail(pool, input.email);
  const pinHash = coordinator ? await getCoordinatorPinHash(pool, coordinator.id) : null;
  const valid = await verifyPassword(input.pin, pinHash ?? DUMMY_HASH);
  if (!coordinator || !pinHash || !valid) {
    throw new InvalidCoordinatorCredentialsError();
  }
  return coordinator;
}
