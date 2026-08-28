import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { registerSecurity } from './plugins/security';
import { registerAuth } from './plugins/auth-plugin';
import { authRoutes } from './routes/auth';
import { editionRoutes } from './routes/editions';
import { instrumentRoutes } from './routes/instruments';
import { journeyRoutes } from './routes/journeys';
import { firmTeamRoutes } from './routes/firm-team';
import { governedContentRoutes } from './routes/governed-content';
import { firmPortalRoutes } from './routes/firm-portal';
import { reportingRoutes } from './routes/reporting';
import { scoringRoutes } from './routes/scoring';
import { peopleRoutes } from './routes/people';
import { invitationsRoutes } from './routes/invitations';
import { missionBoardRoutes } from './routes/mission-board';
import { regulatorRoutes } from './routes/regulators';
import { institutionRoutes } from './routes/institutions';
import { monitoringRoutes } from './routes/monitoring';
import { firmResultsRoutes } from './routes/firm-results';
import { managedContentRoutes } from './routes/managed-content';
import { dragnetRoutes } from './routes/dragnet';
import { firmDigestRoutes } from './routes/firm-digest';
import { publicContentRoutes } from './routes/public-content';

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
      redact: {
        paths: [
          'req.headers.authorization',
          'req.body.password',
          'req.body.currentPassword',
          'req.body.newPassword',
        ],
        censor: '[REDACTED]',
      },
    },
    disableRequestLogging: process.env['NODE_ENV'] === 'test',
  });

  // Register Zod as the schema compiler for the entire server
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await registerSecurity(app);
  await registerAuth(app);

  await app.register(authRoutes);
  await app.register(editionRoutes);
  await app.register(instrumentRoutes);
  await app.register(journeyRoutes);
  await app.register(firmTeamRoutes);
  await app.register(governedContentRoutes);
  await app.register(firmPortalRoutes);
  await app.register(reportingRoutes);
  await app.register(scoringRoutes);
  await app.register(peopleRoutes);
  await app.register(invitationsRoutes);
  await app.register(missionBoardRoutes);
  await app.register(regulatorRoutes);
  await app.register(institutionRoutes);
  await app.register(monitoringRoutes);
  await app.register(firmResultsRoutes);
  await app.register(managedContentRoutes);
  await app.register(dragnetRoutes);
  await app.register(firmDigestRoutes);
  await app.register(publicContentRoutes);

  app.setErrorHandler<Error>((error, request, reply) => {
    const statusCode = resolveStatusCode(error);
    const message = statusCode < 500 ? error.message : 'Internal server error';
    if (statusCode >= 500) {
      request.log.error(error);
    }
    void reply.status(statusCode).send({
      error: error.name ?? 'Error',
      message,
      statusCode,
    });
  });

  return app;
}

/**
 * Map known error types to HTTP status codes. Domain rule violations and
 * auth/maker-checker errors become 4xx; everything unrecognized is 500.
 * Matched by error name so this stays decoupled from the domain package.
 */
function resolveStatusCode(error: Error & { statusCode?: number }): number {
  if (typeof error.statusCode === 'number') return error.statusCode;
  switch (error.name) {
    case 'PermissionDeniedError':
    case 'MakerCheckerViolationError':
      return 403;
    case 'InvalidReasonError':
    case 'ResponseScopeError':
    case 'ReviewGapError':
    case 'FirmPortalError':
    case 'SignoffPayloadError':
      return 400;
    case 'ConsentRequiredError':
    case 'PinVerificationError':
    case 'PrivacyConsentRequiredError':
    case 'FirmResultsAccessError':
    case 'ManagedContentPermissionError':
    case 'DragnetPermissionError':
    case 'ParticipationClosedError':
      return 403;
    case 'EditionStateError':
    case 'InstrumentsNotFrozenError':
    case 'CriticalActionStateError':
    case 'FirmTeamError':
    case 'AlreadyClaimedError':
    case 'SeatConflictError':
    case 'NationalReportError':
    case 'FirmReportError':
    case 'ScoringSignoffError':
    case 'ScoringBlockedError':
    case 'PeopleAccessError':
    case 'InvitationsError':
    case 'RegulatorEngagementError':
    case 'ReminderTimingError':
    case 'FirmResultsError':
    case 'ManagedContentError':
    case 'InvestorCategoriesError':
    case 'FirmDigestError':
    case 'DomainError':
      return 409;
    default:
      return 500;
  }
}
