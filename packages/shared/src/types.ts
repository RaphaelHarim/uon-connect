import type {
  DepartmentRole,
  Permission,
  PlatformRole,
  PresenceStatus,
  TeamRole,
  Theme,
} from './constants.js';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    correlationId?: string;
  };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface UserSummary {
  id: string;
  displayName: string;
  email: string;
  jobTitle: string | null;
  avatarUrl: string | null;
  status: 'active' | 'inactive' | 'offboarded';
  isDemo: boolean;
}

export interface MeResponse {
  user: UserSummary & { phone: string | null; isFounder: boolean };
  roles: PlatformRole[];
  permissions: Permission[];
  departments: { id: string; name: string; role: DepartmentRole; acceptsTickets: boolean }[];
  teams: {
    id: string;
    name: string;
    role: TeamRole;
    departmentId: string;
    departmentName: string;
    clientId: string | null;
    clientName: string | null;
  }[];
  scopes: {
    headDepartmentIds: string[];
    agentDepartmentIds: string[];
    coordinatedTeamIds: string[];
    overseenTeamIds: string[];
  };
  preferences: { theme: Theme; notifications: Record<string, { inApp: boolean; email: boolean }> };
  csrfToken: string;
  authMethod: 'entra' | 'dev';
}

export interface PublicConfig {
  appName: string;
  environment: 'development' | 'test' | 'production';
  demoMode: boolean;
  auth: { devLoginEnabled: boolean; entraEnabled: boolean };
  uploads: { maxFileSizeBytes: number; allowedMimeTypes: string[] };
  calls: { maxParticipants: number; turnConfigured: boolean };
  integrations: { teamsMeetings: boolean; outlookCalendar: boolean };
  brand: { logoUrl: string | null };
}

export interface PresenceView {
  userId: string;
  status: PresenceStatus;
  source: 'absence' | 'manual' | 'automatic';
  connected: boolean;
  message: string | null;
  lastSeenAt: string | null;
}
