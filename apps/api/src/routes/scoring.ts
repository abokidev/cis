import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getPool } from '@cis/db';
import {
  triggerScoringRun,
  listScoringRuns,
  getScoreView,
  requestSignoff,
  approveSignoff,
  listSignoffs,
  getAuthoritativeSignoff,
} from '@cis/domain';

/**
 * Scoring & sign-off routes — UX-ADM-004 (Setup: Results, Scores). The
 * maker-checker gate on which scoring run becomes official. Scoring is refused
 * while the edition is open (a hard precondition on the endpoint, not a UI
 * state); a run is made authoritative only by a structured, second-person
 * sign-off. Domain errors carry codes the shared error handler maps to 4xx.
 */
export const scoringRoutes: FastifyPluginAsyncZod = async (app) => {
  // Trigger a scoring run — blocked unless the edition is locked.
  app.post(
    '/editions/:id/scoring-runs',
    { preHandler: [app.authenticate], schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request, reply) => {
      const { run } = await triggerScoringRun(getPool(), { editionId: request.params.id });
      return reply.status(201).send({ run });
    },
  );

  // The permanent scoring history + the current authoritative sign-off.
  app.get(
    '/editions/:id/scoring-runs',
    { preHandler: [app.authenticate], schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request, reply) => {
      const pool = getPool();
      const runs = await listScoringRuns(pool, request.params.id);
      const signoffs = await listSignoffs(pool, request.params.id);
      const authoritative = await getAuthoritativeSignoff(pool, request.params.id);
      return reply.send({ runs, signoffs, authoritative });
    },
  );

  // The transparency view: each index's score, population, and floor-clear status.
  app.get(
    '/editions/:id/scoring-runs/:runId/scores',
    {
      preHandler: [app.authenticate],
      schema: { params: z.object({ id: z.string().uuid(), runId: z.string().uuid() }) },
    },
    async (request, reply) => {
      const scores = await getScoreView(getPool(), request.params.id, request.params.runId);
      return reply.send({ scores });
    },
  );

  // Request sign-off — the STRUCTURED checked-account, not a bare reason.
  app.post(
    '/editions/:id/scoring-runs/:runId/signoff/request',
    {
      preHandler: [app.authenticate],
      schema: {
        params: z.object({ id: z.string().uuid(), runId: z.string().uuid() }),
        body: z.object({
          requestedBy: z.string().min(1),
          checkedAccount: z.object({
            populationCountsReviewed: z.boolean(),
            floorStatusReviewed: z.boolean(),
            dataQualityFlagsReviewed: z.boolean(),
            notes: z.string().optional(),
          }),
        }),
      },
    },
    async (request, reply) => {
      const signoff = await requestSignoff(getPool(), {
        editionId: request.params.id,
        calculationRunId: request.params.runId,
        requestedBy: request.body.requestedBy,
        checkedAccount: request.body.checkedAccount,
      });
      return reply.status(201).send({ signoff });
    },
  );

  // Approve a sign-off — a different person than the requester.
  app.post(
    '/scoring-signoffs/:signoffId/approve',
    {
      preHandler: [app.authenticate],
      schema: {
        params: z.object({ signoffId: z.string().uuid() }),
        body: z.object({ approvedBy: z.string().min(1) }),
      },
    },
    async (request, reply) => {
      const signoff = await approveSignoff(getPool(), {
        signoffId: request.params.signoffId,
        approvedBy: request.body.approvedBy,
      });
      return reply.send({ signoff });
    },
  );
};
