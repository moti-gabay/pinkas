import { schema } from '@pinkas/db';
import { categoryDto, createRuleBody, ruleDto, updateRuleBody, uuid } from '@pinkas/shared';
import { PinkasError } from '@pinkas/shared';
import { applyRules, normalizeMerchant, sortRules } from '@pinkas/domain';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const categoryRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/categories', { schema: { response: { 200: z.array(categoryDto) } } }, async () => {
    return app.db.select().from(schema.categories).orderBy(asc(schema.categories.sort));
  });

  app.get('/rules', { schema: { response: { 200: z.array(ruleDto) } } }, async () => {
    return app.db
      .select()
      .from(schema.categoryRules)
      .orderBy(asc(schema.categoryRules.priority), asc(schema.categoryRules.createdAt));
  });

  app.post(
    '/rules',
    {
      schema: {
        body: createRuleBody,
        response: { 201: z.object({ rule: ruleDto, recategorized: z.number().int() }) },
      },
    },
    async (req, reply) => {
      const { applyToExisting, ...body } = req.body;
      const priority = body.priority ?? (body.origin === 'learned' ? 20 : 10); // user rules outrank seed rules (100)
      const [rule] = await app.db
        .insert(schema.categoryRules)
        .values({
          ...body,
          priority,
          isFixed: body.isFixed ?? null,
          accountScope: body.accountScope ?? null,
        })
        .returning();
      if (!rule) throw new Error('insert failed');
      const recategorized = applyToExisting ? await recategorize(app.db, rule.id) : 0;
      return reply.code(201).send({ rule, recategorized });
    },
  );

  app.patch(
    '/rules/:id',
    {
      schema: { params: z.object({ id: uuid }), body: updateRuleBody, response: { 200: ruleDto } },
    },
    async (req) => {
      const { applyToExisting: _ignored, ...body } = req.body;
      const [rule] = await app.db
        .update(schema.categoryRules)
        .set(body)
        .where(eq(schema.categoryRules.id, req.params.id))
        .returning();
      if (!rule) throw new PinkasError('NOT_FOUND', 'rule not found');
      return rule;
    },
  );

  app.delete('/rules/:id', { schema: { params: z.object({ id: uuid }) } }, async (req) => {
    const deleted = await app.db
      .delete(schema.categoryRules)
      .where(eq(schema.categoryRules.id, req.params.id))
      .returning({ id: schema.categoryRules.id });
    if (deleted.length === 0) throw new PinkasError('NOT_FOUND', 'rule not found');
    return { ok: true };
  });

  /** Re-runs the full rule set over rows whose category was not chosen by hand. */
  app.post('/rules/reapply', async () => ({ recategorized: await recategorize(app.db) }));
};

type Db = Parameters<FastifyPluginAsyncZod>[0]['db'];

async function recategorize(db: Db, onlyRuleId?: string): Promise<number> {
  const rules = sortRules(
    (
      await db.select().from(schema.categoryRules).where(eq(schema.categoryRules.enabled, true))
    ).map((r) => ({
      ...r,
      isFixed: r.isFixed ?? undefined,
      accountScope: r.accountScope ?? undefined,
    })),
  );
  const candidates = await db
    .select({
      id: schema.transactions.id,
      accountId: schema.transactions.accountId,
      merchantNormalized: schema.transactions.merchantNormalized,
      descriptionRaw: schema.transactions.descriptionRaw,
      categoryId: schema.transactions.categoryId,
      categoryRuleId: schema.transactions.categoryRuleId,
    })
    .from(schema.transactions)
    .where(
      or(
        isNull(schema.transactions.categorySource),
        inArray(schema.transactions.categorySource, ['rule', 'default', 'ai']),
      ),
    );
  let changed = 0;
  for (const t of candidates) {
    const hit = applyRules(rules, {
      accountId: t.accountId,
      merchantNormalized: t.merchantNormalized || normalizeMerchant(t.descriptionRaw),
      descriptionRaw: t.descriptionRaw,
    });
    if (!hit) continue;
    if (onlyRuleId && hit.rule.id !== onlyRuleId) continue;
    if (hit.categoryId === t.categoryId && hit.rule.id === t.categoryRuleId) continue;
    await db
      .update(schema.transactions)
      .set({
        categoryId: hit.categoryId,
        categorySource: 'rule',
        categoryRuleId: hit.rule.id,
        isFixed: hit.isFixed ?? null,
        categoryConfidence: null,
      })
      .where(and(eq(schema.transactions.id, t.id)));
    changed++;
  }
  return changed;
}
