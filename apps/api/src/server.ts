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
      return 400;
    case 'ConsentRequiredError':
    case 'PinVerificationError':
    case 'PrivacyConsentRequiredError':
      return 403;
    case 'EditionStateError':
    case 'InstrumentsNotFrozenError':
    case 'CriticalActionStateError':
    case 'FirmTeamError':
    case 'AlreadyClaimedError':
    case 'SeatConflictError':
    case 'DomainError':
      return 409;
    default:
      return 500;
  }
}
