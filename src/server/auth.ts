import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import {
  ROLE_PERMISSIONS,
  UserRole,
  type NotificationPrefs,
  type Permission,
  type UserProfile,
  type UserRoleType,
} from '../shared/types.ts';
import { db } from './db.ts';

export interface AuthRequest extends Request {
  user?: UserProfile;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function mapUserRow(row: Record<string, unknown>): UserProfile {
  let notificationPrefs: NotificationPrefs = {
    delays: true,
    routeChanges: true,
    scheduleChanges: true,
    operationalIssues: true,
    vehicleUnavailable: true,
    favoritesOnly: false,
  };
  try {
    notificationPrefs = {
      ...notificationPrefs,
      ...JSON.parse(String(row.notification_prefs_json || '{}')),
    };
  } catch {
    // use defaults
  }

  return {
    id: Number(row.id),
    name: String(row.name),
    email: String(row.email),
    role: String(row.role) as UserRoleType,
    active: Boolean(row.active),
    accessibilityNeeds: Boolean(row.accessibility_needs),
    notificationPrefs,
    createdAt: String(row.created_at),
  };
}

export function createSession(userId: number): string {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    token,
    userId,
    expiresAt,
    now.toISOString()
  );
  return token;
}

export function getUserByToken(token: string): UserProfile | null {
  if (!token || token.length < 16) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`
    )
    .get(token, new Date().toISOString()) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapUserRow(row);
}

export function hasAdminClaimed(): boolean {
  const row = db
    .prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin_geral' AND active = 1")
    .get() as { cnt: number };
  return row.cnt > 0;
}

export function logAudit(
  user: UserProfile | null | undefined,
  action: string,
  entityType: string,
  entityId: string | number,
  details: string
): void {
  db.prepare(
    `INSERT INTO audit_logs (user_id, user_name, user_role, action, entity_type, entity_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    user?.id ?? null,
    user?.name ?? 'Sistema',
    user?.role ?? 'sistema',
    action,
    entityType,
    String(entityId),
    details,
    new Date().toISOString()
  );
}

export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    const user = getUserByToken(token);
    if (user) req.user = user;
  }
  next();
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Autenticação necessária.' });
    return;
  }
  const token = header.slice(7).trim();
  const user = getUserByToken(token);
  if (!user) {
    res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    return;
  }
  req.user = user;
  next();
}

export function hasPermission(role: UserRoleType, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function requirePermission(permission: Permission) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Autenticação necessária.' });
      return;
    }
    if (req.user.role === UserRole.ADMIN_GERAL || hasPermission(req.user.role, permission)) {
      next();
      return;
    }
    res.status(403).json({
      error: `Acesso negado: perfil "${req.user.role}" não possui permissão "${permission}".`,
    });
  };
}
