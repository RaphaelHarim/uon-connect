import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow();
const id = () => uuid('id').primaryKey().defaultRandom();

/* ============================================================== enums */

export const userStatusEnum = pgEnum('user_status', ['active', 'inactive', 'offboarded']);
export const identityProviderEnum = pgEnum('identity_provider', ['entra', 'dev', 'local']);
export const localTokenPurposeEnum = pgEnum('local_token_purpose', ['invite', 'reset', 'mfa']);
export const platformRoleEnum = pgEnum('platform_role', ['supreme_admin', 'platform_admin', 'auditor']);
export const departmentRoleEnum = pgEnum('department_role', ['member', 'agent', 'head']);
export const teamRoleEnum = pgEnum('team_role', ['member', 'coordinator']);
export const ticketStatusKindEnum = pgEnum('ticket_status_kind', [
  'new',
  'active',
  'waiting',
  'resolved',
  'closed',
  'cancelled',
]);
export const ticketDestinationEnum = pgEnum('ticket_destination', ['team', 'department_head', 'service_desk']);
export const transitionActorEnum = pgEnum('transition_actor', ['requester', 'handler']);
export const filePurposeEnum = pgEnum('file_purpose', ['ticket', 'message', 'avatar']);
export const conversationTypeEnum = pgEnum('conversation_type', ['direct', 'group']);
export const conversationRoleEnum = pgEnum('conversation_role', ['member', 'admin']);
export const memberNotifEnum = pgEnum('member_notification_level', ['all', 'mentions', 'none']);
export const messageKindEnum = pgEnum('message_kind', ['user', 'system']);
export const meetingProviderEnum = pgEnum('meeting_provider', ['webrtc', 'teams']);
export const meetingStatusEnum = pgEnum('meeting_status', ['scheduled', 'live', 'ended', 'cancelled']);
export const meetingRoleEnum = pgEnum('meeting_role', ['host', 'participant']);
export const inviteStatusEnum = pgEnum('invite_status', ['invited', 'accepted', 'declined']);
export const presenceStatusEnum = pgEnum('presence_status', ['available', 'busy', 'dnd', 'away', 'offline']);
export const absenceVisibilityEnum = pgEnum('absence_visibility', ['company', 'department', 'team']);
export const absenceStatusEnum = pgEnum('absence_status', ['scheduled', 'active', 'ended', 'cancelled']);
export const notificationCategoryEnum = pgEnum('notification_category', [
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
]);
export const themeEnum = pgEnum('theme', ['system', 'light', 'dark']);
export const auditOutcomeEnum = pgEnum('audit_outcome', ['success', 'denied', 'failure']);
export const jobStatusEnum = pgEnum('job_status', ['pending', 'running', 'done', 'failed']);
export const integrationStateEnum = pgEnum('integration_state', [
  'not_configured',
  'configured',
  'healthy',
  'degraded',
  'error',
]);

/* ============================================================== organisation */

export const companies = pgTable('companies', {
  id: id(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const departments = pgTable(
  'departments',
  {
    id: id(),
    companyId: uuid('company_id').notNull().references(() => companies.id),
    name: text('name').notNull(),
    description: text('description'),
    acceptsTickets: boolean('accepts_tickets').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('departments_company_name_uq').on(t.companyId, sql`lower(${t.name})`)],
);

export const clients = pgTable(
  'clients',
  {
    id: id(),
    companyId: uuid('company_id').notNull().references(() => companies.id),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('clients_company_name_uq').on(t.companyId, sql`lower(${t.name})`)],
);

export const teams = pgTable(
  'teams',
  {
    id: id(),
    departmentId: uuid('department_id').notNull().references(() => departments.id),
    clientId: uuid('client_id').references(() => clients.id),
    name: text('name').notNull(),
    description: text('description'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('teams_department_name_uq').on(t.departmentId, sql`lower(${t.name})`),
    index('teams_client_idx').on(t.clientId),
  ],
);

/* ============================================================== users & identity */

export const users = pgTable(
  'users',
  {
    id: id(),
    companyId: uuid('company_id').notNull().references(() => companies.id),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    jobTitle: text('job_title'),
    phone: text('phone'),
    avatarFileId: uuid('avatar_file_id').references((): AnyPgColumn => files.id),
    status: userStatusEnum('status').notNull().default('active'),
    isFounder: boolean('is_founder').notNull().default(false),
    isDemo: boolean('is_demo').notNull().default(false),
    deactivatedAt: ts('deactivated_at'),
    deactivationReason: text('deactivation_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(sql`lower(${t.email})`),
    // At most one founder account can ever exist.
    uniqueIndex('users_single_founder_uq').on(t.isFounder).where(sql`${t.isFounder}`),
    index('users_status_idx').on(t.status),
  ],
);

export const userIdentities = pgTable(
  'user_identities',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id),
    provider: identityProviderEnum('provider').notNull(),
    tenantId: text('tenant_id').notNull().default(''),
    /** Stable identifier from the identity provider (Entra ID: object id `oid`). */
    subject: text('subject').notNull(),
    emailAtLink: text('email_at_link'),
    createdAt: createdAt(),
    lastLoginAt: ts('last_login_at'),
  },
  (t) => [
    uniqueIndex('user_identities_subject_uq').on(t.provider, t.tenantId, t.subject),
    uniqueIndex('user_identities_user_provider_uq').on(t.userId, t.provider),
  ],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id').notNull().references(() => users.id),
    role: platformRoleEnum('role').notNull(),
    grantedBy: uuid('granted_by').references(() => users.id),
    grantedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

export const departmentMemberships = pgTable(
  'department_memberships',
  {
    userId: uuid('user_id').notNull().references(() => users.id),
    departmentId: uuid('department_id').notNull().references(() => departments.id),
    role: departmentRoleEnum('role').notNull().default('member'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.departmentId] }),
    index('department_memberships_dept_idx').on(t.departmentId, t.role),
  ],
);

export const teamMemberships = pgTable(
  'team_memberships',
  {
    userId: uuid('user_id').notNull().references(() => users.id),
    teamId: uuid('team_id').notNull().references(() => teams.id),
    role: teamRoleEnum('role').notNull().default('member'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.teamId] }), index('team_memberships_team_idx').on(t.teamId, t.role)],
);

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the opaque session token; the raw token only lives in the cookie. */
    id: text('id').primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id),
    authMethod: identityProviderEnum('auth_method').notNull(),
    csrfToken: text('csrf_token').notNull(),
    /** True when the login included a second factor (local accounts with TOTP). */
    mfa: boolean('mfa').notNull().default(false),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    revokedReason: text('revoked_reason'),
  },
  (t) => [index('sessions_user_idx').on(t.userId, t.revokedAt)],
);

export const authFlows = pgTable('auth_flows', {
  state: text('state').primaryKey(),
  nonce: text('nonce').notNull(),
  codeVerifier: text('code_verifier').notNull(),
  returnTo: text('return_to'),
  createdAt: createdAt(),
  expiresAt: ts('expires_at').notNull(),
});

/**
 * Username/password accounts (LOCAL_AUTH_ENABLED). A row exists once an administrator invites
 * the user; password_hash stays null until the invitation is accepted. Hashes use scrypt.
 */
export const localCredentials = pgTable('local_credentials', {
  userId: uuid('user_id').primaryKey().references(() => users.id),
  passwordHash: text('password_hash'),
  passwordChangedAt: ts('password_changed_at'),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: ts('locked_until'),
  /** TOTP secret encrypted with TOKEN_ENCRYPTION_KEY; active only when totp_enabled_at is set. */
  totpSecretEnc: text('totp_secret_enc'),
  totpEnabledAt: ts('totp_enabled_at'),
  /** Last accepted TOTP time step, to refuse replay of the same code. */
  totpLastStep: bigint('totp_last_step', { mode: 'number' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** One-time tokens: invitation and password reset links, and the second step of a 2FA login. */
export const localAuthTokens = pgTable(
  'local_auth_tokens',
  {
    /** SHA-256 of the token; the raw value is only shown once. */
    id: text('id').primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id),
    purpose: localTokenPurposeEnum('purpose').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
  },
  (t) => [index('local_auth_tokens_user_idx').on(t.userId, t.purpose)],
);

/** Delegated Microsoft Graph tokens, encrypted at rest (AES-256-GCM). */
export const oauthTokens = pgTable('oauth_tokens', {
  userId: uuid('user_id').primaryKey().references(() => users.id),
  accessTokenEnc: text('access_token_enc').notNull(),
  refreshTokenEnc: text('refresh_token_enc'),
  scopes: text('scopes').notNull(),
  expiresAt: ts('expires_at').notNull(),
  updatedAt: updatedAt(),
});

export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id').primaryKey().references(() => users.id),
  theme: themeEnum('theme').notNull().default('system'),
  notifications: jsonb('notifications').$type<Record<string, { inApp: boolean; email: boolean }>>().notNull().default({}),
  updatedAt: updatedAt(),
});

/* ============================================================== files */

export const files = pgTable(
  'files',
  {
    id: id(),
    storageKey: text('storage_key').notNull().unique(),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    uploadedBy: uuid('uploaded_by').notNull().references((): AnyPgColumn => users.id),
    purpose: filePurposeEnum('purpose').notNull(),
    /** Ticket or conversation the file was uploaded into. Enforced again at download. */
    contextId: uuid('context_id'),
    createdAt: createdAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('files_uploader_idx').on(t.uploadedBy), index('files_context_idx').on(t.contextId)],
);

/* ============================================================== tickets */

export const ticketCategories = pgTable('ticket_categories', {
  id: id(),
  name: text('name').notNull(),
  description: text('description'),
  /** When set, tickets of this category always go to that department's service desk. */
  serviceDepartmentId: uuid('service_department_id').references(() => departments.id),
  defaultConfidential: boolean('default_confidential').notNull().default(false),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(100),
  createdAt: createdAt(),
});

export const ticketPriorities = pgTable('ticket_priorities', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  rank: integer('rank').notNull(),
  color: text('color').notNull(),
  active: boolean('active').notNull().default(true),
});

export const ticketStatuses = pgTable('ticket_statuses', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  kind: ticketStatusKindEnum('kind').notNull(),
  color: text('color').notNull(),
  sortOrder: integer('sort_order').notNull(),
});

export const ticketStatusTransitions = pgTable(
  'ticket_status_transitions',
  {
    fromStatus: text('from_status').notNull().references(() => ticketStatuses.key),
    toStatus: text('to_status').notNull().references(() => ticketStatuses.key),
    actor: transitionActorEnum('actor').notNull(),
    requiresReason: boolean('requires_reason').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.fromStatus, t.toStatus, t.actor] }),
    check('transition_not_self', sql`${t.fromStatus} <> ${t.toStatus}`),
  ],
);

export const businessCalendars = pgTable('business_calendars', {
  id: id(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull(),
  /** { "1": [["09:00","18:00"]], ... } — keys are ISO weekday numbers 0 (Sunday) to 6. */
  workingHours: jsonb('working_hours').$type<Record<string, [string, string][]>>().notNull(),
  createdAt: createdAt(),
});

export const businessHolidays = pgTable(
  'business_holidays',
  {
    id: id(),
    calendarId: uuid('calendar_id').notNull().references(() => businessCalendars.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    name: text('name').notNull(),
  },
  (t) => [uniqueIndex('business_holidays_uq').on(t.calendarId, t.date)],
);

export const slaPolicies = pgTable(
  'sla_policies',
  {
    id: id(),
    name: text('name').notNull(),
    priorityKey: text('priority_key').notNull().references(() => ticketPriorities.key),
    categoryId: uuid('category_id').references(() => ticketCategories.id),
    calendarId: uuid('calendar_id').notNull().references(() => businessCalendars.id),
    firstResponseMinutes: integer('first_response_minutes').notNull(),
    resolutionMinutes: integer('resolution_minutes').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [check('sla_positive', sql`${t.firstResponseMinutes} > 0 AND ${t.resolutionMinutes} > 0`)],
);

export const tickets = pgTable(
  'tickets',
  {
    id: id(),
    number: bigserial('number', { mode: 'number' }).notNull().unique(),
    protocol: text('protocol').notNull().unique(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    requesterId: uuid('requester_id').notNull().references(() => users.id),
    requesterDepartmentId: uuid('requester_department_id').references(() => departments.id),
    requesterTeamId: uuid('requester_team_id').references(() => teams.id),
    clientId: uuid('client_id').references(() => clients.id),
    categoryId: uuid('category_id').notNull().references(() => ticketCategories.id),
    priorityKey: text('priority_key').notNull().references(() => ticketPriorities.key),
    statusKey: text('status_key').notNull().references(() => ticketStatuses.key),
    destination: ticketDestinationEnum('destination').notNull(),
    handlingDepartmentId: uuid('handling_department_id').notNull().references(() => departments.id),
    handlingTeamId: uuid('handling_team_id').references(() => teams.id),
    assigneeId: uuid('assignee_id').references(() => users.id),
    confidential: boolean('confidential').notNull().default(false),
    slaPolicyId: uuid('sla_policy_id').references(() => slaPolicies.id),
    firstResponseDueAt: ts('first_response_due_at'),
    resolutionDueAt: ts('resolution_due_at'),
    firstRespondedAt: ts('first_responded_at'),
    resolvedAt: ts('resolved_at'),
    closedAt: ts('closed_at'),
    cancelledAt: ts('cancelled_at'),
    reopenedCount: integer('reopened_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('tickets_requester_idx').on(t.requesterId, t.createdAt),
    index('tickets_assignee_idx').on(t.assigneeId, t.statusKey),
    index('tickets_handling_dept_idx').on(t.handlingDepartmentId, t.statusKey),
    index('tickets_handling_team_idx').on(t.handlingTeamId, t.statusKey),
    index('tickets_requester_team_idx').on(t.requesterTeamId),
    index('tickets_requester_dept_idx').on(t.requesterDepartmentId),
    index('tickets_client_idx').on(t.clientId, t.createdAt),
    index('tickets_created_idx').on(t.createdAt),
    index('tickets_updated_idx').on(t.updatedAt),
  ],
);

export const ticketComments = pgTable(
  'ticket_comments',
  {
    id: id(),
    ticketId: uuid('ticket_id').notNull().references(() => tickets.id),
    authorId: uuid('author_id').notNull().references(() => users.id),
    body: text('body').notNull(),
    /** Internal notes are only visible to the people handling the ticket. */
    internal: boolean('internal').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('ticket_comments_ticket_idx').on(t.ticketId, t.createdAt)],
);

export const ticketAttachments = pgTable(
  'ticket_attachments',
  {
    fileId: uuid('file_id').primaryKey().references(() => files.id),
    ticketId: uuid('ticket_id').notNull().references(() => tickets.id),
    commentId: uuid('comment_id').references(() => ticketComments.id),
    createdAt: createdAt(),
  },
  (t) => [index('ticket_attachments_ticket_idx').on(t.ticketId)],
);

export const ticketEvents = pgTable(
  'ticket_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ticketId: uuid('ticket_id').notNull().references(() => tickets.id),
    actorId: uuid('actor_id').references(() => users.id),
    type: text('type').notNull(),
    fromValue: text('from_value'),
    toValue: text('to_value'),
    data: jsonb('data').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('ticket_events_ticket_idx').on(t.ticketId, t.createdAt)],
);

export const ticketWatchers = pgTable(
  'ticket_watchers',
  {
    ticketId: uuid('ticket_id').notNull().references(() => tickets.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    addedBy: uuid('added_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.ticketId, t.userId] }), index('ticket_watchers_user_idx').on(t.userId)],
);

/* ============================================================== chat */

export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    type: conversationTypeEnum('type').notNull(),
    name: text('name'),
    description: text('description'),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    teamId: uuid('team_id').references(() => teams.id),
    /** "<smaller uuid>:<larger uuid>" for direct conversations, guaranteeing one per pair. */
    directKey: text('direct_key').unique(),
    allowMembersInvite: boolean('allow_members_invite').notNull().default(false),
    archivedAt: ts('archived_at'),
    lastMessageAt: ts('last_message_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('direct_has_key', sql`(${t.type} = 'direct') = (${t.directKey} IS NOT NULL)`),
    index('conversations_team_idx').on(t.teamId),
  ],
);

export const conversationMembers = pgTable(
  'conversation_members',
  {
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    role: conversationRoleEnum('role').notNull().default('member'),
    notifications: memberNotifEnum('notifications').notNull().default('all'),
    addedBy: uuid('added_by').references(() => users.id),
    joinedAt: ts('joined_at').notNull().defaultNow(),
    leftAt: ts('left_at'),
    lastReadAt: ts('last_read_at'),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId] }),
    index('conversation_members_user_idx').on(t.userId, t.leftAt),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: id(),
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id),
    senderId: uuid('sender_id').references(() => users.id),
    kind: messageKindEnum('kind').notNull().default('user'),
    body: text('body').notNull(),
    replyToId: uuid('reply_to_id').references((): AnyPgColumn => messages.id),
    important: boolean('important').notNull().default(false),
    /** Client-generated id that makes message sending idempotent (safe retries). */
    clientNonce: uuid('client_nonce'),
    createdAt: createdAt(),
    editedAt: ts('edited_at'),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    index('messages_conversation_idx').on(t.conversationId, t.createdAt.desc()),
    uniqueIndex('messages_nonce_uq').on(t.senderId, t.clientNonce),
    index('messages_fts_idx').using('gin', sql`to_tsvector('portuguese', ${t.body})`),
  ],
);

export const messageAttachments = pgTable(
  'message_attachments',
  {
    fileId: uuid('file_id').primaryKey().references(() => files.id),
    messageId: uuid('message_id').notNull().references(() => messages.id),
  },
  (t) => [index('message_attachments_message_idx').on(t.messageId)],
);

export const messageReactions = pgTable(
  'message_reactions',
  {
    messageId: uuid('message_id').notNull().references(() => messages.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    emoji: text('emoji').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })],
);

export const messageMentions = pgTable(
  'message_mentions',
  {
    messageId: uuid('message_id').notNull().references(() => messages.id),
    userId: uuid('user_id').notNull().references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId] })],
);

/* ============================================================== meetings */

export const meetings = pgTable(
  'meetings',
  {
    id: id(),
    title: text('title').notNull(),
    conversationId: uuid('conversation_id').references(() => conversations.id),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    provider: meetingProviderEnum('provider').notNull().default('webrtc'),
    status: meetingStatusEnum('status').notNull().default('scheduled'),
    scheduledStartAt: ts('scheduled_start_at'),
    scheduledEndAt: ts('scheduled_end_at'),
    startedAt: ts('started_at'),
    endedAt: ts('ended_at'),
    externalJoinUrl: text('external_join_url'),
    createdAt: createdAt(),
  },
  (t) => [index('meetings_start_idx').on(t.scheduledStartAt)],
);

export const meetingParticipants = pgTable(
  'meeting_participants',
  {
    meetingId: uuid('meeting_id').notNull().references(() => meetings.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    role: meetingRoleEnum('role').notNull().default('participant'),
    inviteStatus: inviteStatusEnum('invite_status').notNull().default('invited'),
    joinedAt: ts('joined_at'),
    leftAt: ts('left_at'),
  },
  (t) => [primaryKey({ columns: [t.meetingId, t.userId] }), index('meeting_participants_user_idx').on(t.userId)],
);

/* ============================================================== presence & absence */

export const userPresence = pgTable('user_presence', {
  userId: uuid('user_id').primaryKey().references(() => users.id),
  manualStatus: presenceStatusEnum('manual_status'),
  manualExpiresAt: ts('manual_expires_at'),
  statusMessage: text('status_message'),
  lastSeenAt: ts('last_seen_at'),
  updatedAt: updatedAt(),
});

export const absenceSchedules = pgTable(
  'absence_schedules',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    message: text('message'),
    substituteUserId: uuid('substitute_user_id').references(() => users.id),
    visibility: absenceVisibilityEnum('visibility').notNull().default('company'),
    status: absenceStatusEnum('status').notNull().default('scheduled'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('absence_range', sql`${t.endsAt} > ${t.startsAt}`),
    index('absence_user_idx').on(t.userId, t.status),
    index('absence_schedule_idx').on(t.status, t.startsAt, t.endsAt),
  ],
);

/* ============================================================== notifications */

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id),
    category: notificationCategoryEnum('category').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    link: text('link'),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    /** Unread notifications sharing a key are merged instead of piling up. */
    dedupeKey: text('dedupe_key'),
    count: integer('count').notNull().default(1),
    readAt: ts('read_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.readAt, t.updatedAt.desc()),
    uniqueIndex('notifications_dedupe_uq').on(t.userId, t.dedupeKey).where(sql`${t.readAt} IS NULL`),
  ],
);

/* ============================================================== audit */

export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    actorLabel: text('actor_label'),
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    outcome: auditOutcomeEnum('outcome').notNull(),
    correlationId: text('correlation_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    /** Hash chain computed by a database trigger; see migration 0001. */
    prevHash: text('prev_hash'),
    hash: text('hash'),
  },
  (t) => [
    index('audit_occurred_idx').on(t.occurredAt.desc()),
    index('audit_actor_idx').on(t.actorUserId, t.occurredAt),
    index('audit_resource_idx').on(t.resourceType, t.resourceId),
    index('audit_action_idx').on(t.action, t.occurredAt),
  ],
);

/* ============================================================== platform */

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: updatedAt(),
});

export const integrationStatus = pgTable('integration_status', {
  key: text('key').primaryKey(),
  state: integrationStateEnum('state').notNull(),
  lastCheckedAt: ts('last_checked_at'),
  lastError: text('last_error'),
  details: jsonb('details').$type<Record<string, unknown>>(),
  updatedAt: updatedAt(),
});

export const integrationEvents = pgTable(
  'integration_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    integrationKey: text('integration_key').notNull(),
    outcome: auditOutcomeEnum('outcome').notNull(),
    message: text('message').notNull(),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
  },
  (t) => [index('integration_events_key_idx').on(t.integrationKey, t.occurredAt)],
);

export const jobs = pgTable(
  'jobs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: jobStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    runAt: ts('run_at').notNull().defaultNow(),
    lockedAt: ts('locked_at'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    finishedAt: ts('finished_at'),
  },
  (t) => [index('jobs_pending_idx').on(t.status, t.runAt)],
);
