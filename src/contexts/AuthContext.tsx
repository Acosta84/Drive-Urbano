import React, { createContext, useCallback, useContext, useState } from 'react';
import {
  ROLE_PERMISSIONS,
  UserRole,
  type NotificationPrefs,
  type Permission,
  type UserProfile,
  type UserRoleType,
} from '../shared/types.ts';

interface AuthContextValue {
  user: UserProfile;
  adminDemoRole: UserRoleType;
  setAdminDemoRole: (role: UserRoleType) => void;
  updatePreferences: (patch: {
    name?: string;
    accessibilityNeeds?: boolean;
    notificationPrefs?: NotificationPrefs;
  }) => void;
  can: (permission: Permission) => boolean;
}

const DEFAULT_USER: UserProfile = {
  id: 1,
  name: 'Marina Vasconcelos',
  email: 'marina.passageira@mobilicidade.rio',
  role: UserRole.PASSAGEIRO,
  active: true,
  accessibilityNeeds: false,
  notificationPrefs: {
    delays: true,
    routeChanges: true,
    scheduleChanges: true,
    operationalIssues: true,
    vehicleUnavailable: true,
    favoritesOnly: false,
  },
  createdAt: new Date().toISOString(),
};

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile>(DEFAULT_USER);
  const [adminDemoRole, setAdminDemoRole] = useState<UserRoleType>(UserRole.ADMIN_GERAL);

  const updatePreferences = useCallback(
    (patch: {
      name?: string;
      accessibilityNeeds?: boolean;
      notificationPrefs?: NotificationPrefs;
    }) => {
      setUser((prev) => ({
        ...prev,
        name: patch.name !== undefined && patch.name.trim() ? patch.name.trim() : prev.name,
        accessibilityNeeds:
          patch.accessibilityNeeds !== undefined ? patch.accessibilityNeeds : prev.accessibilityNeeds,
        notificationPrefs: patch.notificationPrefs ?? prev.notificationPrefs,
      }));
    },
    []
  );

  const can = useCallback(
    (permission: Permission) => {
      if (adminDemoRole === UserRole.ADMIN_GERAL) return true;
      return ROLE_PERMISSIONS[adminDemoRole]?.includes(permission) ?? false;
    },
    [adminDemoRole]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        adminDemoRole,
        setAdminDemoRole,
        updatePreferences,
        can,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
