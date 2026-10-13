import { relations } from 'drizzle-orm';
import { accounts, categories, categoryRules, sources, transactions } from './tables.js';

export const sourcesRelations = relations(sources, ({ many }) => ({ accounts: many(accounts) }));
export const accountsRelations = relations(accounts, ({ one, many }) => ({
  source: one(sources, { fields: [accounts.sourceId], references: [sources.id] }),
  transactions: many(transactions),
}));
export const transactionsRelations = relations(transactions, ({ one }) => ({
  account: one(accounts, { fields: [transactions.accountId], references: [accounts.id] }),
  category: one(categories, { fields: [transactions.categoryId], references: [categories.id] }),
  rule: one(categoryRules, {
    fields: [transactions.categoryRuleId],
    references: [categoryRules.id],
  }),
}));
export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, { fields: [categories.parentId], references: [categories.id] }),
  rules: many(categoryRules),
}));
