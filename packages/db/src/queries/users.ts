import { Pool } from 'pg';
import type { User, Role, Permission, PermissionType } from '@cis/shared-types';
import { query } from '../client';

// ─── Row mappers ──────────────────────────────────────────────────────────────

interface RawUserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  is_active: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface RawRoleRow {
  id: string;
  name: string;
  description: string | null;
  created_at: Date;
}

interface RawPermissionRow {
  id: string;
  code: string;
  description: string | null;
  permission_type: string;
  action_scope: string | null;
  created_at: Date;
}

function mapUser(row: RawUserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRole(row: RawRoleRow): Role {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
  };
}

function mapPermission(row: RawPermissionRow): Permission {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    permissionType: row.permission_type as PermissionType,
    actionScope: row.action_scope,
    createdAt: row.created_at,
  };
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function createUser(
  pool: Pool,
  data: { email: string; passwordHash: string; displayName: string },
): Promise<User> {
  const result = await query<RawUserRow>(
    pool,
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [data.email, data.passwordHash, data.displayName],
  );
  const row = result.rows[0];
  if (!row) throw new Error('User insert returned no rows');
  return mapUser(row);
}

export async function getUserByEmail(pool: Pool, email: string): Promise<User | null> {
  const result = await query<RawUserRow>(
    pool,
    'SELECT * FROM users WHERE email = $1 AND is_active = TRUE',
    [email],
  );
  const row = result.rows[0];
  return row ? mapUser(row) : null;
}

export async function getUserById(pool: Pool, id: string): Promise<User | null> {
  const result = await query<RawUserRow>(
    pool,
    'SELECT * FROM users WHERE id = $1 AND is_active = TRUE',
    [id],
  );
  const row = result.rows[0];
  return row ? mapUser(row) : null;
}

export async function updateLastLogin(pool: Pool, userId: string): Promise<void> {
  await query(pool, 'UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);
}

// ─── Roles ────────────────────────────────────────────────────────────────────

export async function createRole(
  pool: Pool,
  data: { name: string; description?: string },
): Promise<Role> {
  const result = await query<RawRoleRow>(
    pool,
    `INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING *`,
    [data.name, data.description ?? null],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Role insert returned no rows');
  return mapRole(row);
}

export async function assignRoleToUser(
  pool: Pool,
  userId: string,
  roleId: string,
  grantedBy: string | null,
): Promise<void> {
  await query(
    pool,
    `INSERT INTO user_roles (user_id, role_id, granted_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [userId, roleId, grantedBy],
  );
}

// ─── Permissions ──────────────────────────────────────────────────────────────

export async function createPermission(
  pool: Pool,
  data: {
    code: string;
    description?: string;
    permissionType?: PermissionType;
    actionScope?: string;
  },
): Promise<Permission> {
  const result = await query<RawPermissionRow>(
    pool,
    `INSERT INTO permissions (code, description, permission_type, action_scope)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [
      data.code,
      data.description ?? null,
      data.permissionType ?? 'standard',
      data.actionScope ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Permission insert returned no rows');
  return mapPermission(row);
}

export async function assignPermissionToRole(
  pool: Pool,
  roleId: string,
  permissionId: string,
): Promise<void> {
  await query(
    pool,
    `INSERT INTO role_permissions (role_id, permission_id)
     VALUES ($1, $2)
     ON CONFLICT (role_id, permission_id) DO NOTHING`,
    [roleId, permissionId],
  );
}

/** Returns all permission codes held by a user across all their roles. */
export async function getUserPermissions(pool: Pool, userId: string): Promise<Permission[]> {
  const result = await query<RawPermissionRow>(
    pool,
    `SELECT DISTINCT p.*
     FROM permissions p
     JOIN role_permissions rp ON rp.permission_id = p.id
     JOIN user_roles ur ON ur.role_id = rp.role_id
     WHERE ur.user_id = $1`,
    [userId],
  );
  return result.rows.map(mapPermission);
}
