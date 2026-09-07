import type { AuditEvent, CreateAuditEvent } from "@/lib/domain";
import { redact } from "@/lib/logger";

export type AuditWriter = {
  record(event: CreateAuditEvent): Promise<AuditEvent | void>;
};

export function createRepositoryAuditWriter(create: {
  create: (event: CreateAuditEvent) => Promise<AuditEvent>;
}): AuditWriter {
  return {
    async record(event) {
      return create.create({
        ...event,
        input: redact(event.input),
        details: redact(event.details),
      });
    },
  };
}

export function createInMemoryAuditWriter(): AuditWriter & { events: CreateAuditEvent[] } {
  const events: CreateAuditEvent[] = [];
  return {
    events,
    async record(event) {
      events.push({
        ...event,
        input: redact(event.input),
        details: redact(event.details),
      });
    },
  };
}
