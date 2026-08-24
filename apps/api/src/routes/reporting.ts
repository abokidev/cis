import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getPool, getNationalReport } from '@cis/db';
import {
  generateNationalReport,
  openDraft,
  nationalApprovalPreconditions,
  requestNationalApproval,
  approveNational,
  getSections,
  generateFirmReports,
  approveFirmReport,
  releaseFirmReports,
  getFirmReports,
  type SufficiencyContext,
} from '@cis/domain';

/**
 * Reporting routes — UX-ADM-005 (national report review/approval) and
 * UX-ADM-006 (firm report generation/release). Operator-authenticated. The two
 * surfaces are kept distinct: their guarantee semantics differ, and conflating
 * them is the historical mistake this design corrects.
 */
export const reportingRoutes: FastifyPluginAsyncZod = async (app) => {
  const segment = z.object({ meets: z.boolean(), thin: z.boolean() });

  // ── National report (UX-ADM-005) ──────────────────────────────────────────
  app.post(
    '/editions/:id/national-report',
    {
      preHandler: [app.authenticate],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          scoringRunId: z.string().uuid(),
          context: z.object({
            segments: z.record(z.string(), segment),
            regulatorsEngaged: z.number().int().min(0).max(3),
          }),
        }),
      },
    },
    async (request, reply) => {
      const { report, sections } = await generateNationalReport(getPool(), {
        editionId: request.params.id,
        scoringRunId: request.body.scoringRunId,
        context: request.body.context as SufficiencyContext,
      });
      return reply.status(201).send({ reportId: report.id, sections });
    },
  );

  app.get(
    '/national-reports/:id',
    { preHandler: [app.authenticate], schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request, reply) => {
      const pool = getPool();
      const report = await getNationalReport(pool, request.params.id);
      if (!report)
        return reply
          .status(404)
          .send({ error: 'Not Found', message: 'No such report', statusCode: 404 });
      const sections = await getSections(pool, request.params.id);
      const preconditions = await nationalApprovalPreconditions(pool, request.params.id);
      return reply.send({ report, sections, preconditions });
    },
  );

  app.post(
    '/national-reports/:id/open',
    { preHandler: [app.authenticate], schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request, reply) => {
      await openDraft(getPool(), request.params.id);
      return reply.send({ opened: true });
    },
  );

  app.post(
    '/national-reports/:id/request-approval',
    {
      preHandler: [app.authenticate],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ requestedBy: z.string().min(1), reason: z.string().min(10) }),
      },
    },
    async (request, reply) => {
      await requestNationalApproval(getPool(), request.params.id, {
        requestedBy: request.body.requestedBy,
        reason: request.body.reason,
      });
      return reply.send({ requested: true });
    },
  );

  app.post(
    '/national-reports/:id/approve',
    {
      preHandler: [app.authenticate],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ approvedBy: z.string().min(1) }),
      },
    },
    async (request, reply) => {
      const report = await approveNational(getPool(), request.params.id, request.body.approvedBy);
      return reply.send({ status: report.status });
    },
  );

  // ── Firm reports (UX-ADM-006) ─────────────────────────────────────────────
  app.get(
    '/editions/:id/firm-reports',
    { preHandler: [app.authenticate], schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request, reply) => {
      const reports = await getFirmReports(getPool(), request.params.id);
      return reply.send({ reports });
    },
  );

  app.post(
    '/editions/:id/firm-reports/generate',
    {
      preHandler: [app.authenticate],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ scoringRunId: z.string().uuid() }),
      },
    },
    async (request, reply) => {
      const result = await generateFirmReports(getPool(), {
        editionId: request.params.id,
        scoringRunId: request.body.scoringRunId,
      });
      return reply.status(201).send(result);
    },
  );

  app.post(
    '/firm-reports/:id/approve',
    { preHandler: [app.authenticate], schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request, reply) => {
      const report = await approveFirmReport(getPool(), request.params.id);
      return reply.send({ approvalState: report.approvalState });
    },
  );

  // Atomic per-report release. Blocked until the national report is approved.
  app.post(
    '/editions/:id/firm-reports/release',
    { preHandler: [app.authenticate], schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request, reply) => {
      const result = await releaseFirmReports(getPool(), request.params.id);
      return reply.send({
        released: result.released.map((r) => r.organizationId),
        held: result.held.map((h) => ({
          organizationId: h.report.organizationId,
          reason: h.reason,
        })),
      });
    },
  );
};
