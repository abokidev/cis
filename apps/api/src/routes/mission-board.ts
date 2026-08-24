import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getPool, listInstitutionEngagement, setInstitutionEngagement } from '@cis/db';
import { getMissionBoard, ingestZeptomailEvent } from '@cis/domain';

/**
 * Mission board routes — UX-OPS-001. The board is evaluated live at an
 * evaluation instant (`asOf`, injectable so an operator can preview; production
 * runs hourly). Also carries the institution-engagement setters (until UX-OPS-007
 * owns them) and the Zeptomail delivery webhook.
 */
export const missionBoardRoutes: FastifyPluginAsyncZod = async (app) => {
  const editionParam = z.object({ id: z.string().uuid() });

  app.get(
    '/editions/:id/mission-board',
    {
      preHandler: [app.authenticate],
      schema: {
        params: editionParam,
        querystring: z.object({ asOf: z.string().datetime().optional() }),
      },
    },
    async (request, reply) => {
      const asOf = request.query.asOf ? new Date(request.query.asOf) : new Date();
      const board = await getMissionBoard(getPool(), request.params.id, asOf);
      return reply.send(board);
    },
  );

  app.get(
    '/editions/:id/institution-engagement',
    { preHandler: [app.authenticate], schema: { params: editionParam } },
    async (request, reply) => {
      const rows = await listInstitutionEngagement(getPool(), request.params.id);
      return reply.send({ institutions: rows });
    },
  );

  app.patch(
    '/editions/:id/institution-engagement/:institution',
    {
      preHandler: [app.authenticate],
      schema: {
        params: z.object({
          id: z.string().uuid(),
          institution: z.enum(['SEC', 'NGX', 'CSCS']),
        }),
        body: z.object({
          status: z
            .enum(['not_started', 'invited', 'in_progress', 'confirmed', 'declined'])
            .optional(),
          targetBy: z.string().date().optional(),
        }),
      },
    },
    async (request, reply) => {
      const updated = await setInstitutionEngagement(
        getPool(),
        request.params.id,
        request.params.institution,
        {
          ...(request.body.status ? { status: request.body.status } : {}),
          ...(request.body.targetBy ? { targetBy: new Date(request.body.targetBy) } : {}),
        },
      );
      return reply.send({ institution: updated });
    },
  );

  // Zeptomail delivery webhook (delivered/bounced/opened/clicked). No auth
  // decorator — a real deployment verifies the provider's signature instead;
  // here it maps the event onto the matching recipient.
  app.post(
    '/invitations/zeptomail-webhook',
    {
      schema: {
        body: z.object({
          batchId: z.string().uuid(),
          recipientEmail: z.string(),
          event: z.enum(['email.delivered', 'email.bounced', 'email.opened', 'email.clicked']),
          at: z.string().datetime().optional(),
        }),
      },
    },
    async (request, reply) => {
      const matched = await ingestZeptomailEvent(getPool(), {
        batchId: request.body.batchId,
        recipientEmail: request.body.recipientEmail,
        event: request.body.event,
        ...(request.body.at ? { at: new Date(request.body.at) } : {}),
      });
      return reply.send({ matched });
    },
  );
};
