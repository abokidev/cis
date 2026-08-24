import type { FastifyReply } from 'fastify';
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getPool,
  listEditions,
  getEditionById,
  getUserById,
  listSampleFloors,
  isEditionInstrumentSetFrozen,
  getPendingCriticalActionForEdition,
} from '@cis/db';
import { loadRbacContext } from '@cis/auth';
import {
  setSampleFloor,
  setClosingDate,
  requestLock,
  decideLock,
  EDITION_LOCK_ACTION,
} from '@cis/domain';
import type { CriticalAction } from '@cis/shared-types';

const CATEGORY = z.enum(['firm', 'retail', 'local_institution', 'foreign_institution']);

const FloorSchema = z.object({ category: CATEGORY, floorValue: z.number().int().min(1) });

const PendingActionSchema = z
  .object({
    id: z.string().uuid(),
    reason: z.string(),
    requestedAt: z.string(),
    requestedBy: z.object({
      id: z.string().uuid(),
      displayName: z.string(),
      org: z.string().nullable(),
    }),
  })
  .nullable();

const EditionDetailSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  status: z.enum(['draft', 'open', 'locked', 'archived']),
  surveyOpenAt: z.string().nullable(),
  surveyCloseAt: z.string().nullable(),
  lockedAt: z.string().nullable(),
  frozen: z.boolean(),
  floors: z.array(FloorSchema),
  pendingLock: PendingActionSchema,
});

const not = (reply: FastifyReply, code: number, error: string, message: string) =>
  (reply as FastifyReply).status(code).send({ error, message, statusCode: code });

async function serializePending(
  pool: ReturnType<typeof getPool>,
  action: CriticalAction | null,
): Promise<z.infer<typeof PendingActionSchema>> {
  if (!action) return null;
  const requester = await getUserById(pool, action.requestedBy);
  const reason = typeof action.payload['reason'] === 'string' ? action.payload['reason'] : '';
  return {
    id: action.id,
    reason,
    requestedAt: action.requestedAt.toISOString(),
    requestedBy: {
      id: action.requestedBy,
      displayName: requester?.displayName ?? 'Unknown',
      org: requester?.organization ?? null,
    },
  };
}

export const editionRoutes: FastifyPluginAsyncZod = async (app) => {
  // List editions — the admin frontend uses this to locate the current edition.
  app.get(
    '/editions',
    {
      preHandler: [app.authenticate],
      schema: {
        response: {
          200: z.array(
            z.object({
              id: z.string().uuid(),
              label: z.string(),
              status: z.enum(['draft', 'open', 'locked', 'archived']),
            }),
          ),
        },
      },
    },
    async (_request, reply) => {
      const editions = await listEditions(getPool());
      return reply.send(editions.map((e) => ({ id: e.id, label: e.label, status: e.status })));
    },
  );

  // Full state of one edition: dates, floors, frozen status, pending lock.
  app.get(
    '/editions/:id',
    {
      preHandler: [app.authenticate],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: EditionDetailSchema },
      },
    },
    async (request, reply) => {
      const pool = getPool();
      const edition = await getEditionById(pool, request.params.id);
      if (!edition) return not(reply, 404, 'Not Found', 'Edition not found');

      const [floors, frozen, pending] = await Promise.all([
        listSampleFloors(pool, edition.id),
        isEditionInstrumentSetFrozen(pool, edition.id),
        getPendingCriticalActionForEdition(pool, edition.id, EDITION_LOCK_ACTION),
      ]);

      return reply.send({
        id: edition.id,
        label: edition.label,
        status: edition.status,
        surveyOpenAt: edition.surveyOpenAt?.toISOString() ?? null,
        surveyCloseAt: edition.surveyCloseAt?.toISOString() ?? null,
        lockedAt: edition.lockedAt?.toISOString() ?? null,
        frozen,
        floors: floors.map((f) => ({ category: f.category, floorValue: f.floorValue })),
        pendingLock: await serializePending(pool, pending),
      });
    },
  );

  // Set sample floors (draft-only, enforced by the service). Accepts one or more.
  app.patch(
    '/editions/:id/floors',
    {
      preHandler: [app.authenticate],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ floors: z.array(FloorSchema).min(1) }),
        response: { 200: z.object({ floors: z.array(FloorSchema) }) },
      },
    },
    async (request, reply) => {
      const pool = getPool();
      const rbac = await loadRbacContext(pool, request.user.sub);
      const ctx = { ipAddress: request.ip, userAgent: request.headers['user-agent'] ?? null };
      for (const f of request.body.floors) {
        await setSampleFloor(pool, rbac, request.params.id, f.category, f.floorValue, ctx);
      }
      const floors = await listSampleFloors(pool, request.params.id);
      return reply.send({
        floors: floors.map((f) => ({ category: f.category, floorValue: f.floorValue })),
      });
    },
  );

  // Set the last day for returns (editable while not locked, enforced by service).
  app.patch(
    '/editions/:id/closing-date',
    {
      preHandler: [app.authenticate],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ closingDate: z.string().date() }),
        response: { 200: z.object({ surveyCloseAt: z.string().nullable() }) },
      },
    },
    async (request, reply) => {
      const pool = getPool();
      const rbac = await loadRbacContext(pool, request.user.sub);
      const closesAt = new Date(`${request.body.closingDate}T00:00:00.000Z`);
      const updated = await setClosingDate(pool, rbac, request.params.id, closesAt, {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });
      return reply.send({ surveyCloseAt: updated.surveyCloseAt?.toISOString() ?? null });
    },
  );

  // Request the lock (maker step).
  app.post(
    '/editions/:id/lock/request',
    {
      preHandler: [app.authenticate],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ reason: z.string() }),
        response: { 201: z.object({ criticalActionId: z.string().uuid() }) },
      },
    },
    async (request, reply) => {
      const pool = getPool();
      const rbac = await loadRbacContext(pool, request.user.sub);
      const action = await requestLock(pool, rbac, request.params.id, request.body.reason, {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });
      return reply.status(201).send({ criticalActionId: action.id });
    },
  );

  // Decide the lock (checker step). Self-decide is rejected by the service.
  app.post(
    '/editions/:id/lock/:actionId/decide',
    {
      preHandler: [app.authenticate],
      schema: {
        params: z.object({ id: z.string().uuid(), actionId: z.string().uuid() }),
        body: z.object({ approved: z.boolean(), rejectionReason: z.string().optional() }),
        response: {
          200: z.object({
            status: z.enum(['approved', 'rejected']),
            editionStatus: z.enum(['draft', 'open', 'locked', 'archived']),
          }),
        },
      },
    },
    async (request, reply) => {
      const pool = getPool();
      const rbac = await loadRbacContext(pool, request.user.sub);
      const { action, edition } = await decideLock(
        pool,
        rbac,
        request.params.id,
        request.params.actionId,
        { approved: request.body.approved, rejectionReason: request.body.rejectionReason },
        { ipAddress: request.ip, userAgent: request.headers['user-agent'] ?? null },
      );
      return reply.send({
        status: action.status as 'approved' | 'rejected',
        editionStatus: edition.status,
      });
    },
  );
};
