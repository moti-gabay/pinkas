import { createHash, randomBytes } from 'node:crypto';
import { schema } from '@pinkas/db';
import { PinkasError } from '@pinkas/shared';
import argon2 from 'argon2';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

export const SESSION_COOKIE = 'pinkas_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PASSWORD_KEY = 'auth_password_hash';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

declare module 'fastify' {
  interface FastifyInstance {
    auth: {
      isSetup(): Promise<boolean>;
      setPassword(password: string): Promise<void>;
      login(password: string, reply: FastifyReply): Promise<void>;
      logout(req: FastifyRequest, reply: FastifyReply): Promise<void>;
      requireSession(req: FastifyRequest, reply: FastifyReply): Promise<void>;
    };
  }
}

const plugin: FastifyPluginAsync = async (app) => {
  const { db } = app;

  async function getHash(): Promise<string | undefined> {
    const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, PASSWORD_KEY) });
    return typeof row?.value === 'string' ? row.value : undefined;
  }

  function setCookie(reply: FastifyReply, token: string, maxAgeSec: number): void {
    void reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: maxAgeSec,
      secure: 'auto',
    });
  }

  app.decorate('auth', {
    async isSetup() {
      return (await getHash()) !== undefined;
    },
    async setPassword(password) {
      if (await getHash()) throw new PinkasError('CONFLICT', 'password already set');
      const hash = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
      });
      await db
        .insert(schema.settings)
        .values({ key: PASSWORD_KEY, value: hash })
        .onConflictDoNothing();
    },
    async login(password, reply) {
      const hash = await getHash();
      if (!hash || !(await argon2.verify(hash, password)))
        throw new PinkasError('UNAUTHORIZED', 'bad password');
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await db.insert(schema.sessions).values({ tokenHash: sha256(token), expiresAt });
      setCookie(reply, token, SESSION_TTL_MS / 1000);
    },
    async logout(req, reply) {
      const token = req.cookies[SESSION_COOKIE];
      if (token)
        await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token)));
      void reply.clearCookie(SESSION_COOKIE, { path: '/' });
    },
    async requireSession(req, reply) {
      const token = req.cookies[SESSION_COOKIE];
      if (!token) throw new PinkasError('UNAUTHORIZED', 'no session');
      const now = new Date();
      const session = await db.query.sessions.findFirst({
        where: and(
          eq(schema.sessions.tokenHash, sha256(token)),
          gt(schema.sessions.expiresAt, now),
        ),
      });
      if (!session) {
        void reply.clearCookie(SESSION_COOKIE, { path: '/' });
        throw new PinkasError('UNAUTHORIZED', 'expired session');
      }
      // Sliding expiry, refreshed at most once a minute to keep writes cheap.
      if (now.getTime() - session.lastSeenAt.getTime() > 60_000) {
        const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
        await db
          .update(schema.sessions)
          .set({ lastSeenAt: now, expiresAt })
          .where(eq(schema.sessions.id, session.id));
        setCookie(reply, token, SESSION_TTL_MS / 1000);
      }
    },
  });
};

export const authPlugin = fp(plugin, { name: 'auth', dependencies: ['db'] });
