import { z } from 'zod';
import {
  ABSENCE_VISIBILITIES,
  ALLOWED_REACTIONS,
  DEPARTMENT_ROLES,
  MEMBER_NOTIFICATION_LEVELS,
  NOTIFICATION_CATEGORIES,
  PLATFORM_ROLES,
  PRESENCE_STATUSES,
  TEAM_ROLES,
  THEMES,
  TICKET_DESTINATIONS,
  TICKET_STATUS_KEYS,
  TICKET_STATUS_KINDS,
  TRANSITION_ACTORS,
} from '../constants.js';

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);
export const uuid = z.uuid();

/* ---------------------------------------------------------------- common */

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const idParam = z.object({ id: uuid });

/** Accepts a comma-separated query value or a repeated one and returns an array. */
export const csvArray = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => {
    if (v === undefined || v === '') return undefined;
    if (Array.isArray(v)) return v.flatMap((x) => String(x).split(',')).filter(Boolean);
    return String(v).split(',').filter(Boolean);
  }, z.array(item).max(50).optional());

/* ---------------------------------------------------------------- auth */

export const devLoginBody = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});

/* ---------------------------------------------------------------- org */

export const departmentBody = z.object({
  name: trimmed(2, 80),
  description: z.string().trim().max(500).optional().nullable(),
  acceptsTickets: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const teamBody = z.object({
  departmentId: uuid,
  name: trimmed(2, 80),
  description: z.string().trim().max(500).optional().nullable(),
  clientId: uuid.optional().nullable(),
  active: z.boolean().default(true),
});

export const clientBody = z.object({
  name: trimmed(2, 120),
  active: z.boolean().default(true),
});

/* ---------------------------------------------------------------- users */

export const createUserBody = z.object({
  email: z.email().max(254).transform((e) => e.toLowerCase()),
  displayName: trimmed(2, 120),
  jobTitle: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
});

export const updateUserBody = z.object({
  displayName: trimmed(2, 120).optional(),
  jobTitle: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
});

export const userStatusBody = z.object({
  status: z.enum(['active', 'inactive', 'offboarded']),
  reason: z.string().trim().max(500).optional(),
});

export const bulkUserStatusBody = z.object({
  userIds: z.array(uuid).min(1).max(200),
  status: z.enum(['active', 'inactive', 'offboarded']),
  reason: z.string().trim().max(500).optional(),
});

export const roleGrantBody = z.object({ role: z.enum(PLATFORM_ROLES) });

export const departmentMembershipBody = z.object({
  departmentId: uuid,
  role: z.enum(DEPARTMENT_ROLES),
});

export const teamMembershipBody = z.object({
  teamId: uuid,
  role: z.enum(TEAM_ROLES),
});

export const updateProfileBody = z.object({
  displayName: trimmed(2, 120).optional(),
  phone: z.string().trim().max(40).optional().nullable(),
});

export const preferencesBody = z.object({
  theme: z.enum(THEMES).optional(),
  notifications: z
    .record(
      z.enum(NOTIFICATION_CATEGORIES),
      z.object({ inApp: z.boolean(), email: z.boolean() }),
    )
    .optional(),
});

/* ---------------------------------------------------------------- tickets */

export const createTicketBody = z.object({
  title: trimmed(4, 160),
  description: trimmed(1, 10_000),
  categoryId: uuid,
  priority: z.string().min(1).max(30),
  destination: z.enum(TICKET_DESTINATIONS),
  /** Team (for destination=team), department (for department_head / service_desk). */
  targetId: uuid,
  clientId: uuid.optional().nullable(),
  confidential: z.boolean().default(false),
});

export const ticketListQuery = paginationQuery.extend({
  view: z.enum(['all', 'requested', 'assigned', 'queue', 'watching']).default('all'),
  status: csvArray(z.enum(TICKET_STATUS_KEYS)),
  priority: csvArray(z.string().max(30)),
  categoryId: uuid.optional(),
  assigneeId: z.union([uuid, z.literal('none'), z.literal('me')]).optional(),
  teamId: uuid.optional(),
  departmentId: uuid.optional(),
  clientId: uuid.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  q: z.string().trim().max(120).optional(),
  sort: z.enum(['created_desc', 'created_asc', 'updated_desc', 'priority_desc']).default('updated_desc'),
});

export const ticketCommentBody = z.object({
  body: trimmed(1, 10_000),
  internal: z.boolean().default(false),
  attachmentIds: z.array(uuid).max(10).default([]),
});

export const ticketStatusBody = z.object({
  status: z.enum(TICKET_STATUS_KEYS),
  reason: z.string().trim().max(1000).optional(),
});

export const ticketAssignBody = z.object({ assigneeId: uuid.nullable() });
export const ticketPriorityBody = z.object({ priority: z.string().min(1).max(30) });
export const ticketWatcherBody = z.object({ userId: uuid });

export const categoryBody = z.object({
  name: trimmed(2, 80),
  description: z.string().trim().max(500).optional().nullable(),
  serviceDepartmentId: uuid.optional().nullable(),
  defaultConfidential: z.boolean().default(false),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(100),
});

export const priorityBody = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,29}$/),
  label: trimmed(2, 40),
  rank: z.number().int().min(0).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  active: z.boolean().default(true),
});

export const statusLabelBody = z.object({
  label: trimmed(2, 40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sortOrder: z.number().int().min(0).max(1000),
});

export const transitionBody = z.object({
  fromStatus: z.enum(TICKET_STATUS_KEYS),
  toStatus: z.enum(TICKET_STATUS_KEYS),
  actor: z.enum(TRANSITION_ACTORS),
  requiresReason: z.boolean().default(false),
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const workingHoursSchema = z.record(
  z.enum(['0', '1', '2', '3', '4', '5', '6']),
  z.array(z.tuple([hhmm, hhmm])).max(4),
);

export const calendarBody = z.object({
  name: trimmed(2, 80),
  timezone: z.string().min(3).max(64),
  workingHours: workingHoursSchema,
});

export const holidayBody = z.object({ date: z.iso.date(), name: trimmed(2, 80) });

export const slaPolicyBody = z.object({
  name: trimmed(2, 80),
  priorityKey: z.string().min(1).max(30),
  categoryId: uuid.optional().nullable(),
  calendarId: uuid,
  firstResponseMinutes: z.number().int().min(1).max(60 * 24 * 60),
  resolutionMinutes: z.number().int().min(1).max(60 * 24 * 120),
  active: z.boolean().default(true),
});

/* ---------------------------------------------------------------- dashboards */

export const dashboardQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  departmentId: uuid.optional(),
  teamId: uuid.optional(),
  clientId: uuid.optional(),
  assigneeId: uuid.optional(),
});

/* ---------------------------------------------------------------- chat */

export const createDirectBody = z.object({ userId: uuid });

export const createGroupBody = z.object({
  name: trimmed(2, 80),
  description: z.string().trim().max(500).optional().nullable(),
  memberIds: z.array(uuid).max(200).default([]),
  teamId: uuid.optional().nullable(),
  allowMembersInvite: z.boolean().default(false),
});

export const updateGroupBody = z.object({
  name: trimmed(2, 80).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  allowMembersInvite: z.boolean().optional(),
});

export const addMembersBody = z.object({ userIds: z.array(uuid).min(1).max(100) });
export const memberRoleBody = z.object({ role: z.enum(['member', 'admin']) });
export const memberSettingsBody = z.object({ notifications: z.enum(MEMBER_NOTIFICATION_LEVELS) });

export const sendMessageBody = z.object({
  body: z.string().max(8000).default(''),
  clientNonce: uuid,
  replyToId: uuid.optional().nullable(),
  attachmentIds: z.array(uuid).max(10).default([]),
  mentions: z.array(uuid).max(50).default([]),
  important: z.boolean().default(false),
});

export const editMessageBody = z.object({ body: trimmed(1, 8000) });

export const messagesQuery = z.object({
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

export const reactionBody = z.object({ emoji: z.enum(ALLOWED_REACTIONS) });

export const messageSearchQuery = z.object({
  q: trimmed(2, 120),
  conversationId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/* ---------------------------------------------------------------- presence / absence */

export const presenceBody = z.object({
  status: z.enum(PRESENCE_STATUSES).nullable(),
  message: z.string().trim().max(140).optional().nullable(),
  expiresAt: z.iso.datetime({ offset: true }).optional().nullable(),
});

export const absenceBody = z
  .object({
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    message: z.string().trim().max(500).optional().nullable(),
    substituteUserId: uuid.optional().nullable(),
    visibility: z.enum(ABSENCE_VISIBILITIES).default('company'),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: 'O término deve ser posterior ao início.',
    path: ['endsAt'],
  });

/* ---------------------------------------------------------------- meetings */

export const createMeetingBody = z.object({
  title: trimmed(2, 120),
  participantIds: z.array(uuid).max(50).default([]),
  conversationId: uuid.optional().nullable(),
  scheduledStartAt: z.iso.datetime({ offset: true }).optional().nullable(),
  scheduledEndAt: z.iso.datetime({ offset: true }).optional().nullable(),
  provider: z.enum(['webrtc', 'teams']).default('webrtc'),
});

export const meetingResponseBody = z.object({ response: z.enum(['accepted', 'declined']) });
export const meetingToGroupBody = z.object({ name: trimmed(2, 80) });

/* ---------------------------------------------------------------- notifications */

export const notificationListQuery = z.object({
  unreadOnly: z.coerce.boolean().default(false),
  category: z.enum(NOTIFICATION_CATEGORIES).optional(),
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/* ---------------------------------------------------------------- search & audit */

export const globalSearchQuery = z.object({ q: trimmed(2, 120) });

export const auditListQuery = paginationQuery.extend({
  action: z.string().max(80).optional(),
  actorId: uuid.optional(),
  resourceType: z.string().max(40).optional(),
  resourceId: z.string().max(80).optional(),
  outcome: z.enum(['success', 'denied', 'failure']).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export const settingsBody = z.object({
  chatDirectPolicy: z.enum(['company', 'department']).optional(),
  chatGroupCreation: z.enum(['everyone', 'leaders']).optional(),
  ticketReopenWindowDays: z.number().int().min(0).max(90).optional(),
  ticketAutoCloseResolvedDays: z.number().int().min(0).max(90).optional(),
});

export { TICKET_STATUS_KINDS };
