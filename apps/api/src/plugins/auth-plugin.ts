import { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import type { SessionPayload } from '@cis/shared-types';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: SessionPayload;
    user: SessionPayload;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    session: SessionPayload;
  }
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  const secret = process.env['JWT_SECRET'];
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters');
  }

  await app.register(fastifyJwt, {
    secret,
    sign: { expiresIn: '8h', algorithm: 'HS256' },
    verify: { algorithms: ['HS256'] },
  });

  // Decorator to protect routes
  app.decorate('authenticate', async (request: FastifyRequest) => {
    await request.jwtVerify();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fastify-jwt stores on request.user
    (request as any).session = (request as any).user as SessionPayload;
  });
}

// Extend Fastify instance type so routes can reference app.authenticate
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
}
