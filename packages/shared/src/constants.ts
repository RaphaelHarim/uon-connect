/**
 * Domain constants shared by the API and the web client.
 * Labels are in pt-BR because the product is used in Portuguese; keys are stable identifiers.
 */

export const PLATFORM_ROLES = ['supreme_admin', 'platform_admin', 'auditor'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  supreme_admin: 'Supreme Admin',
  platform_admin: 'Administrador da plataforma',
  auditor: 'Auditor',
};

export const DEPARTMENT_ROLES = ['member', 'agent', 'head'] as const;
export type DepartmentRole = (typeof DEPARTMENT_ROLES)[number];
export const DEPARTMENT_ROLE_LABELS: Record<DepartmentRole, string> = {
  member: 'Membro',
  agent: 'Atendente',
  head: 'Responsável pelo departamento',
};

export const TEAM_ROLES = ['member', 'coordinator'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];
export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  member: 'Membro',
  coordinator: 'Coordenador',
};

export const USER_STATUSES = ['active', 'inactive', 'offboarded'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  active: 'Ativo',
  inactive: 'Desativado',
  offboarded: 'Desligado',
};

/** Permissions granted by platform roles. Scoped access (teams, departments) is evaluated separately. */
export const PERMISSIONS = [
  'org.manage',
  'users.manage',
  'users.manage_privileged',
  'roles.grant.platform_admin',
  'roles.grant.auditor',
  'roles.grant.supreme_admin',
  'tickets.config.manage',
  'settings.manage',
  'audit.read',
  'security.read',
  'sessions.revoke',
  'integrations.read',
  'admin.dashboard',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const TICKET_STATUS_KEYS = [
  'open',
  'triage',
  'in_progress',
  'waiting_requester',
  'waiting_third_party',
  'resolved',
  'closed',
  'cancelled',
] as const;
export type TicketStatusKey = (typeof TICKET_STATUS_KEYS)[number];

export const TICKET_STATUS_KINDS = ['new', 'active', 'waiting', 'resolved', 'closed', 'cancelled'] as const;
export type TicketStatusKind = (typeof TICKET_STATUS_KINDS)[number];

/** Default labels; the database copy is editable by administrators. */
export const DEFAULT_TICKET_STATUS_LABELS: Record<TicketStatusKey, string> = {
  open: 'Aberto',
  triage: 'Em triagem',
  in_progress: 'Em andamento',
  waiting_requester: 'Aguardando solicitante',
  waiting_third_party: 'Aguardando terceiro',
  resolved: 'Resolvido',
  closed: 'Encerrado',
  cancelled: 'Cancelado',
};

export const TICKET_STATUS_KIND_OF: Record<TicketStatusKey, TicketStatusKind> = {
  open: 'new',
  triage: 'active',
  in_progress: 'active',
  waiting_requester: 'waiting',
  waiting_third_party: 'waiting',
  resolved: 'resolved',
  closed: 'closed',
  cancelled: 'cancelled',
};

/** Statuses that count as "still open work" in metrics. */
export const OPEN_TICKET_STATUSES: TicketStatusKey[] = [
  'open',
  'triage',
  'in_progress',
  'waiting_requester',
  'waiting_third_party',
];

export const TICKET_DESTINATIONS = ['team', 'department_head', 'service_desk'] as const;
export type TicketDestination = (typeof TICKET_DESTINATIONS)[number];
export const TICKET_DESTINATION_LABELS: Record<TicketDestination, string> = {
  team: 'Minha equipe / coordenação',
  department_head: 'Responsável pelo departamento',
  service_desk: 'Central de atendimento do departamento',
};

export const TRANSITION_ACTORS = ['requester', 'handler'] as const;
export type TransitionActor = (typeof TRANSITION_ACTORS)[number];

export const PRESENCE_STATUSES = ['available', 'busy', 'dnd', 'away', 'offline'] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];
export const PRESENCE_LABELS: Record<PresenceStatus, string> = {
  available: 'Disponível',
  busy: 'Ocupado',
  dnd: 'Não incomodar',
  away: 'Ausente',
  offline: 'Offline',
};

export const ABSENCE_VISIBILITIES = ['company', 'department', 'team'] as const;
export type AbsenceVisibility = (typeof ABSENCE_VISIBILITIES)[number];
export const ABSENCE_VISIBILITY_LABELS: Record<AbsenceVisibility, string> = {
  company: 'Toda a empresa',
  department: 'Meu(s) departamento(s)',
  team: 'Minha(s) equipe(s)',
};

export const ABSENCE_STATUSES = ['scheduled', 'active', 'ended', 'cancelled'] as const;
export type AbsenceStatus = (typeof ABSENCE_STATUSES)[number];

export const NOTIFICATION_CATEGORIES = [
  'ticket_created',
  'ticket_assigned',
  'ticket_comment',
  'ticket_status',
  'message',
  'mention',
  'group_invite',
  'meeting_invite',
  'absence',
  'deadline',
  'integration',
  'security',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  ticket_created: 'Novo chamado',
  ticket_assigned: 'Atribuição de chamado',
  ticket_comment: 'Resposta em chamado',
  ticket_status: 'Mudança de status',
  message: 'Mensagens',
  mention: 'Menções',
  group_invite: 'Convites para grupos',
  meeting_invite: 'Convites para reuniões',
  absence: 'Ausências',
  deadline: 'Prazos e pendências',
  integration: 'Falhas de integração',
  security: 'Segurança da conta',
};

export const CONVERSATION_TYPES = ['direct', 'group'] as const;
export type ConversationType = (typeof CONVERSATION_TYPES)[number];

export const MEMBER_NOTIFICATION_LEVELS = ['all', 'mentions', 'none'] as const;
export type MemberNotificationLevel = (typeof MEMBER_NOTIFICATION_LEVELS)[number];

export const MEETING_STATUSES = ['scheduled', 'live', 'ended', 'cancelled'] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const INVITE_STATUSES = ['invited', 'accepted', 'declined'] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const INTEGRATION_STATES = ['not_configured', 'configured', 'healthy', 'degraded', 'error'] as const;
export type IntegrationState = (typeof INTEGRATION_STATES)[number];
export const INTEGRATION_STATE_LABELS: Record<IntegrationState, string> = {
  not_configured: 'Não configurada',
  configured: 'Configurada (não verificada)',
  healthy: 'Operacional',
  degraded: 'Degradada',
  error: 'Com erro',
};

export const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '🎉', '👀', '✅', '🙏', '😮'] as const;

export const API_PREFIX = '/api/v1';

/** Defaults applied when a user has not changed a category. E-mails stay minimal (no content). */
export const DEFAULT_NOTIFICATION_PREFS: Record<NotificationCategory, { inApp: boolean; email: boolean }> = {
  ticket_created: { inApp: true, email: true },
  ticket_assigned: { inApp: true, email: true },
  ticket_comment: { inApp: true, email: false },
  ticket_status: { inApp: true, email: true },
  message: { inApp: true, email: false },
  mention: { inApp: true, email: false },
  group_invite: { inApp: true, email: false },
  meeting_invite: { inApp: true, email: true },
  absence: { inApp: true, email: false },
  deadline: { inApp: true, email: true },
  integration: { inApp: true, email: false },
  security: { inApp: true, email: true },
};
