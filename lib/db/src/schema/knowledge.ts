import {
  pgTable,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";

export const knowledgeDocumentsTable = pgTable(
  "knowledge_documents",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status").notNull().default("processing"),
    chunkCount: integer("chunk_count"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("knowledge_docs_business_idx").on(t.businessId)],
);

export type KnowledgeDocument = typeof knowledgeDocumentsTable.$inferSelect;

// knowledge_chunks uses pgvector — raw SQL for migration
export const knowledgeChunksTable = pgTable(
  "knowledge_chunks",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => knowledgeDocumentsTable.id, { onDelete: "cascade" }),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    embedding: text("embedding"), // stored as text, queried via raw SQL
    chunkIndex: integer("chunk_index").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("knowledge_chunks_doc_idx").on(t.documentId),
    index("knowledge_chunks_business_idx").on(t.businessId),
  ],
);
