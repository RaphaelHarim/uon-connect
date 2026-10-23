import { addMembersBody, createMeetingBody, idParam, meetingResponseBody, meetingToGroupBody } from '@uon/shared';
import { z } from 'zod';
import type { Deps } from '../../deps.js';
import { reqMeta, requireAuth } from '../../lib/http.js';
import type { App } from '../../lib/types.js';
import type { Extras } from '../../routes.js';
import { createGroup } from '../chat/service.js';
import { GraphClient } from '../integrations/graph.js';
import { addParticipants, createMeeting, endMeeting, iceServers, listMeetings, meetingDetail, participantIdsForGroup, respondMeeting } from './service.js';

export function registerMeetingRoutes(app: App, deps: Deps, extras: Extras) {
  const graph = new GraphClient(deps, extras.entra);

  app.get('/meetings', { schema: { querystring: z.object({ range: z.enum(['upcoming', 'past']).default('upcoming') }) } }, async (req) =>
    listMeetings(deps, requireAuth(req), req.query.range),
  );

  app.post('/meetings', { schema: { body: createMeetingBody } }, async (req) => {
    const m = await createMeeting(deps, requireAuth(req), req.body, graph, reqMeta(req));
    return { id: m.id };
  });

  app.get('/meetings/:id', { schema: { params: idParam } }, async (req) => meetingDetail(deps, requireAuth(req), req.params.id));

  app.post('/meetings/:id/respond', { schema: { params: idParam, body: meetingResponseBody } }, async (req) => {
    await respondMeeting(deps, requireAuth(req), req.params.id, req.body.response);
    return { ok: true };
  });

  app.post('/meetings/:id/participants', { schema: { params: idParam, body: addMembersBody } }, async (req) => {
    await addParticipants(deps, requireAuth(req), req.params.id, req.body.userIds);
    return { ok: true };
  });

  app.post('/meetings/:id/end', { schema: { params: idParam } }, async (req) => {
    await endMeeting(deps, requireAuth(req), req.params.id, reqMeta(req));
    return { ok: true };
  });

  /** Creates a group conversation with the call's participants (the UI asks for confirmation first). */
  app.post('/meetings/:id/create-group', { schema: { params: idParam, body: meetingToGroupBody } }, async (req) => {
    const ctx = requireAuth(req);
    const ids = await participantIdsForGroup(deps, ctx, req.params.id);
    const c = await createGroup(deps, ctx, { name: req.body.name, memberIds: ids, allowMembersInvite: false }, reqMeta(req));
    return { id: c.id };
  });

  app.get('/calls/ice-servers', async (req) => ({ iceServers: iceServers(deps, requireAuth(req).userId) }));
}
