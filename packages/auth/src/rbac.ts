import { Pool } from 'pg';
import { getUserPermissions } from '@cis/db';
import type { Permission } from '@cis/shared-types';

export interface RbacContext {
  userId: string;
  permissions: Permission[];
}

/** Load RBAC context for a user. Cache this in the request lifecycle. */
export async function loadRbacContext(pool: Pool, userId: string): Promise<RbacContext> {
  const permissions = await getUserPermissions(pool, userId);
  return { userId, permissions };
}

/** Check whether a user holds a specific permission code. */
export function hasPermission(context: RbacContext, permissionCode: string): boolean {
  return context.permissions.some((p) => p.code === permissionCode);
}

/** Throw if the user does not hold the required permission. */
export function requirePermission(context: RbacContext, permissionCode: string): void {
  if (!hasPermission(context, permissionCode)) {
    throw new PermissionDeniedError(context.userId, permissionCode);
  }
}

/**
 * Check whether a user can REQUEST a specific critical action type.
 * Requires a permission with type 'can_request_critical_action' and
 * action_scope matching the given actionType (or null = any).
 */
export function canRequestCriticalAction(context: RbacContext, actionType: string): boolean {
  return context.permissions.some(
    (p) =>
      p.permissionType === 'can_request_critical_action' &&
      (p.actionScope === null || p.actionScope === actionType),
  );
}

/**
 * Check whether a user can APPROVE a specific critical action type.
 * Requires a permission with type 'can_approve_critical_action' and
 * action_scope matching the given actionType (or null = any).
 */
export function canApproveCriticalAction(context: RbacContext, actionType: string): boolean {
  return context.permissions.some(
    (p) =>
      p.permissionType === 'can_approve_critical_action' &&
      (p.actionScope === null || p.actionScope === actionType),
  );
}

export class PermissionDeniedError extends Error {
  constructor(
    public readonly userId: string,
    public readonly requiredPermission: string,
  ) {
    super(`User ${userId} does not have permission: ${requiredPermission}`);
    this.name = 'PermissionDeniedError';
  }
}
