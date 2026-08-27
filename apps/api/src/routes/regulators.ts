import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getPool } from '@cis/db';
import {
  listRegulators,
  getRegulator,
  saveContact,
  issueSurveyLink,
  sendReminder,
  sendTextReminder,
  markDeclined,
  markSubmitted,
  recordHistory,
} from '@cis/domain';

/**
 * Regulator engagement routes — UX-OPS-007. One record per (edition, regulator):
 * the named contact, the survey link, the lead time (which lands in Phase 10's
 * institution_engagement.target_by), and an append-only free-text history.
 *
 * The contact-before-survey ordering, the terminal `declined` outcome, and the
 * cancel-and-restart referral are all enforced in the domain service — these
 * routes are thin. The raw institution-engagement setter that used to live on the
 * mission-board route is deliberately gone: a lead time is only ever set through
 * `issue-link`, which requires a saved contact first.
 */
export const regulatorRoutes: FastifyPluginAsyncZod = async (app) => {
  const reg = z.enum(['SEC', 'NGX', 'CSCS']);
  const editionParam = z.object({ id: z.string().uuid() });
  const oneParam = z.object({ id: z.string().uuid(), institution: reg });
  const asOfQuery = z.object({ asOf: z.string().datetime().optional() });
  const asOfOf = (q: { asOf?: string }): Date => (q.asOf ? new Date(q.asOf) : new Date());

  app.get(
    '/editions/:id/regulators',
    { preHandler: [app.authenticate], schema: { params: editionParam, querystring: asOfQuery } },
    async (request, reply) => {
      const regulators = await listRegulators(getPool(), request.params.id, asOfOf(request.query));
      return reply.send({ regulators });
    },
  );

  app.get(
    '/editions/:id/regulators/:institution',
    { preHandler: [app.authenticate], schema: { params: oneParam, querystring: asOfQuery } },
    async (request, reply) => {
      const regulator = await getRegulator(
        getPool(),
        request.params.id,
        request.params.institution,
        asOfOf(request.query),
      );
      return reply.send({ regulator });
    },
  );

  app.put(
    '/editions/:id/regulators/:institution/contact',
    {
      preHandler: [app.authenticate],
      schema: {
        params: oneParam,
        body: z.object({
          who: z.string(),
          role: z.string(),
          email: z.string(),
          phone: z.string(),
          how: z.string(),
        }),
      },
    },
    async (request, reply) => {
      const regulator = await saveContact(
        getPool(),
        request.params.id,
        request.params.institution,
        request.body,
      );
      return reply.send({ regulator });
    },
  );

  app.post(
    '/editions/:id/regulators/:institution/issue-link',
    {
      preHandler: [app.authenticate],
      schema: { params: oneParam, body: z.object({ targetBy: z.string() }) },
    },
    async (request, reply) => {
      const regulator = await issueSurveyLink(
        getPool(),
        request.params.id,
        request.params.institution,
        { targetBy: request.body.targetBy },
      );
      return reply.send({ regulator });
    },
  );

  app.post(
    '/editions/:id/regulators/:institution/reminder',
    { preHandler: [app.authenticate], schema: { params: oneParam } },
    async (request, reply) => {
      const regulator = await sendReminder(
        getPool(),
        request.params.id,
        request.params.institution,
      );
      return reply.send({ regulator });
    },
  );

  app.post(
    '/editions/:id/regulators/:institution/text-reminder',
    { preHandler: [app.authenticate], schema: { params: oneParam } },
    async (request, reply) => {
      const regulator = await sendTextReminder(
        getPool(),
        request.params.id,
        request.params.institution,
      );
      return reply.send({ regulator });
    },
  );

  app.post(
    '/editions/:id/regulators/:institution/decline',
    { preHandler: [app.authenticate], schema: { params: oneParam } },
    async (request, reply) => {
      const regulator = await markDeclined(
        getPool(),
        request.params.id,
        request.params.institution,
      );
      return reply.send({ regulator });
    },
  );

  app.post(
    '/editions/:id/regulators/:institution/submitted',
    { preHandler: [app.authenticate], schema: { params: oneParam } },
    async (request, reply) => {
      const regulator = await markSubmitted(
        getPool(),
        request.params.id,
        request.params.institution,
      );
      return reply.send({ regulator });
    },
  );

  app.post(
    '/editions/:id/regulators/:institution/history',
    {
      preHandler: [app.authenticate],
      schema: { params: oneParam, body: z.object({ entry: z.string() }) },
    },
    async (request, reply) => {
      const regulator = await recordHistory(
        getPool(),
        request.params.id,
        request.params.institution,
        request.body.entry,
      );
      return reply.send({ regulator });
    },
  );
};
