import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { registerSecurity } from './plugins/security';
import { registerAuth } from './plugins/auth-plugin';
import { authRoutes } from './routes/auth';
import { editionRoutes } from './routes/editions';

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

  app.setErrorHandler<Error>((error, _request, reply) => {
    const statusCode = (error as Error & { statusCode?: number }).statusCode ?? 500;
    const message = statusCode < 500 ? error.message : 'Internal server error';
    void reply.status(statusCode).send({
      error: error.name ?? 'Error',
      message,
      statusCode,
    });
  });

  return app;
}
