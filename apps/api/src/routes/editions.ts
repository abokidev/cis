import type { FastifyReply } from 'fastify';
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getPool,
  createEdition,
  getEditionById,
  listEditions,
  createEditionInstrumentSnapshot,
} from '@cis/db';
import {
  loadRbacContext,
  requirePermission,
  requestCriticalAction,
  approveCriticalActionWithRbac,
} from '@cis/auth';
import { writeAudit } from '@cis/audit';

const EditionSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  status: z.enum(['draft', 'open', 'locked', 'archived']),
  surveyOpenAt: z.string().nullable(),
  surveyCloseAt: z.string().nullable(),
  resultsPublishedAt: z.string().nullable(),
  priorEditionId: z.string().uuid().nullable(),
  lockedAt: z.string().nullable(),
  lockedBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const CreateEditionBody = z.object({
  label: z.string().min(1).max(64),
  priorEditionId: z.string().uuid().optional(),
});

const FreezeSnapshotBody = z.object({
  instrumentDefinitionVersionId: z.string().uuid(),
});

const RequestLockBody = z.object({
  reason: z.string().min(1),
});

function serializeEdition(e: {
  id: string;
  label: string;
  status: string;
  surveyOpenAt: Date | null;
  surveyCloseAt: Date | null;
  resultsPublishedAt: Date | null;
  priorEditionId: string | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: e.id,
    label: e.label,
    status: e.status as 'draft' | 'open' | 'locked' | 'archived',
    surveyOpenAt: e.surveyOpenAt?.toISOString() ?? null,
    surveyCloseAt: e.surveyCloseAt?.toISOString() ?? null,
    resultsPublishedAt: e.resultsPublishedAt?.toISOString() ?? null,
    priorEditionId: e.priorEditionId,
    lockedAt: e.lockedAt?.toISOString() ?? null,
    lockedBy: e.lockedBy,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

export const editionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/editions',
    { preHandler: [app.authenticate], schema: { response: { 200: z.array(EditionSchema) } } },
    async (_request, reply) => {
      const editions = await listEditions(getPool());
      return reply.send(editions.map(serializeEdition));
    },
  );

  app.get(
    '/editions/:id',
    {
      preHandler: [app.authenticate],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: EditionSchema },
      },
    },
    async (request, reply) => {
      const edition = await getEditionById(getPool(), request.params.id);
      if (!edition)
        return (reply as FastifyReply).status(404).send({ error: 'Not Found', statusCode: 404 });
      return reply.send(serializeEdition(edition));
    },
  );

  app.post(
    '/editions',
    {
      preHandler: [app.authenticate],
      schema: {
        body: CreateEditionBody,
        response: { 201: EditionSchema },
      },
    },
    async (request, reply) => {
      const pool = getPool();
      const rbac = await loadRbacContext(pool, request.user.sub);
      requirePermission(rbac, 'edition:create');

      const edition = await createEdition(pool, {
        label: request.body.label,
        priorEditionId: request.body.priorEditionId ?? null,
      });

      await writeAudit(pool, {
        actorId: request.user.sub,
        actionType: 'edition.created',
        entityType: 'edition',
        entityId: edition.id,
        newValue: { label: edition.label },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });

      return reply.status(201).send(serializeEdition(edition));
    },
  );

  app.post(
    '/editions/:id/instrument-snapshots',
    {
      preHandler: [app.authenticate],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: FreezeSnapshotBody,
        response: {
          201: z.object({
            id: z.string().uuid(),
            editionId: z.string().uuid(),
            instrumentDefinitionVersionId: z.string().uuid(),
            frozenAt: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const pool = getPool();
      const rbac = await loadRbacContext(pool, request.user.sub);
      requirePermission(rbac, 'edition:manage-instruments');

      const edition = await getEditionById(pool, request.params.id);
      if (!edition)
        return (reply as FastifyReply).status(404).send({ error: 'Not Found', statusCode: 404 });
      if (edition.status === 'locked' || edition.status === 'archived') {
        return (reply as FastifyReply)
          .status(409)
          .send({ error: 'Conflict', message: 'Edition is locked or archived' });
      }

      const snapshot = await createEditionInstrumentSnapshot(pool, {
        editionId: edition.id,
        instrumentDefinitionVersionId: request.body.instrumentDefinitionVersionId,
        frozenBy: request.user.sub,
      });

      await writeAudit(pool, {
        actorId: request.user.sub,
        actionType: 'edition.instrument_snapshot.frozen',
        entityType: 'edition_instrument_snapshot',
        entityId: snapshot.id,
        editionId: edition.id,
        newValue: { instrumentDefinitionVersionId: snapshot.instrumentDefinitionVersionId },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });

      return reply.status(201).send({
        id: snapshot.id,
        editionId: snapshot.editionId,
        instrumentDefinitionVersionId: snapshot.instrumentDefinitionVersionId,
        frozenAt: snapshot.frozenAt.toISOString(),
      });
    },
  );

  app.post(
    '/editions/:id/lock-requests',
    {
      preHandler: [app.authenticate],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: RequestLockBody,
        response: { 201: z.object({ criticalActionId: z.string().uuid() }) },
      },
    },
    async (request, reply) => {
      const pool = getPool();
      const rbac = await loadRbacContext(pool, request.user.sub);

      const edition = await getEditionById(pool, request.params.id);
      if (!edition)
        return (reply as FastifyReply).status(404).send({ error: 'Not Found', statusCode: 404 });
      if (edition.status !== 'open') {
        return (reply as FastifyReply)
          .status(409)
          .send({ error: 'Conflict', message: 'Edition must be open to request lock' });
      }

      const action = await requestCriticalAction(pool, rbac, {
        actionType: 'edition:lock',
        payload: { editionId: edition.id, reason: request.body.reason },
        editionId: edition.id,
      });

      await writeAudit(pool, {
        actorId: request.user.sub,
        actionType: 'critical_action.requested',
        entityType: 'critical_action',
        entityId: action.id,
        editionId: edition.id,
        newValue: { actionType: action.actionType },
        reason: request.body.reason,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });

      return reply.status(201).send({ criticalActionId: action.id });
    },
  );

  app.post(
    '/critical-actions/:id/approve',
    {
      preHandler: [app.authenticate],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ status: z.string() }) },
      },
    },
    async (request, reply) => {
      const pool = getPool();
      const rbac = await loadRbacContext(pool, request.user.sub);

      const action = await approveCriticalActionWithRbac(pool, rbac, request.params.id);

      await writeAudit(pool, {
        actorId: request.user.sub,
        actionType: 'critical_action.approved',
        entityType: 'critical_action',
        entityId: action.id,
        editionId: action.editionId,
        oldValue: { status: 'pending' },
        newValue: { status: 'approved' },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });

      return reply.send({ status: action.status });
    },
  );
};
