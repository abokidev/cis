/**
 * Coordinator sign-in — email + PIN only, never a username/password account
 * (UX-FRM-007). Anti-enumeration discipline mirrors operator login: a wrong
 * email and a wrong PIN both fail with the same error, and revocation ends
 * access immediately even for a coordinator who still remembers the PIN.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { createOrganization, revokeCoordinator } from '@cis/db';
import {
  createLeadCoordinator,
  setCoordinatorPin,
  coordinatorLogin,
  InvalidCoordinatorCredentialsError,
} from '../src';
import { getTestPool, runMigrations, truncateAllTables, closeTestPool } from '../../db/tests/setup';

let pool: Pool;
let orgId: string;

beforeAll(async () => {
  pool = getTestPool();
  await runMigrations();
});
beforeEach(async () => {
  await truncateAllTables(pool);
  const org = await createOrganization(pool, {
    slug: 'auth-firm',
    displayName: 'Auth Firm',
    orgType: 'firm',
  });
  orgId = org.id;
});
afterAll(async () => {
  await closeTestPool();
});

describe('coordinatorLogin', () => {
  it('succeeds with the correct email + PIN', async () => {
    const lead = await createLeadCoordinator(pool, {
      organizationId: orgId,
      name: 'Lead One',
      email: 'Lead1@Firm.example',
    });
    await setCoordinatorPin(pool, lead.id, { newPin: '1234' });

    const result = await coordinatorLogin(pool, { email: 'lead1@firm.example', pin: '1234' });
    expect(result.id).toBe(lead.id);
  });

  it('refuses a wrong PIN', async () => {
    const lead = await createLeadCoordinator(pool, {
      organizationId: orgId,
      name: 'Lead One',
      email: 'lead1@firm.example',
    });
    await setCoordinatorPin(pool, lead.id, { newPin: '1234' });

    await expect(
      coordinatorLogin(pool, { email: 'lead1@firm.example', pin: '0000' }),
    ).rejects.toBeInstanceOf(InvalidCoordinatorCredentialsError);
  });

  it('refuses an email that does not exist, with the same error as a wrong PIN', async () => {
    await expect(
      coordinatorLogin(pool, { email: 'nobody@firm.example', pin: '1234' }),
    ).rejects.toBeInstanceOf(InvalidCoordinatorCredentialsError);
  });

  it('refuses a coordinator who has not set a PIN yet (claim in progress)', async () => {
    await createLeadCoordinator(pool, {
      organizationId: orgId,
      name: 'Lead One',
      email: 'lead1@firm.example',
    });

    await expect(
      coordinatorLogin(pool, { email: 'lead1@firm.example', pin: '1234' }),
    ).rejects.toBeInstanceOf(InvalidCoordinatorCredentialsError);
  });

  it('refuses a revoked coordinator even with the correct PIN', async () => {
    const lead = await createLeadCoordinator(pool, {
      organizationId: orgId,
      name: 'Lead One',
      email: 'lead1@firm.example',
    });
    await setCoordinatorPin(pool, lead.id, { newPin: '1234' });
    await revokeCoordinator(pool, lead.id);

    await expect(
      coordinatorLogin(pool, { email: 'lead1@firm.example', pin: '1234' }),
    ).rejects.toBeInstanceOf(InvalidCoordinatorCredentialsError);
  });
});
