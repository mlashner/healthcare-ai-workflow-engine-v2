import { asc, eq } from "drizzle-orm";

import {
  createProviderSchema,
  providerSchema,
  type CreateProvider,
  type Provider,
} from "@/lib/domain";

import type { Database } from "../client";
import { providers } from "../schema";
import { newEntityId } from "./ids";

export function createProviderRepository(db: Database) {
  return {
    async create(input: CreateProvider): Promise<Provider> {
      const data = createProviderSchema.parse(input);
      const [row] = await db
        .insert(providers)
        .values({
          id: data.id ?? newEntityId(),
          name: data.name,
          role: data.role,
        })
        .returning();

      return providerSchema.parse(row);
    },

    async getById(id: string): Promise<Provider | null> {
      const [row] = await db.select().from(providers).where(eq(providers.id, id)).limit(1);
      return row ? providerSchema.parse(row) : null;
    },

    async list(): Promise<Provider[]> {
      const rows = await db.select().from(providers).orderBy(asc(providers.name));
      return rows.map((row) => providerSchema.parse(row));
    },
  };
}
