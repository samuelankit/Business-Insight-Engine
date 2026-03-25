import { db } from "@workspace/db";
import { knowledgeChunksTable, knowledgeDocumentsTable } from "@workspace/db/schema";
import { eq, and, or, isNull } from "drizzle-orm";
import { openai as replitOpenAI } from "@workspace/integrations-openai-ai-server";

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

async function getQueryEmbedding(query: string): Promise<number[] | null> {
  try {
    const resp = await replitOpenAI.embeddings.create({
      model: "text-embedding-3-small",
      input: query.slice(0, 8191),
    });
    return resp.data[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

export async function searchKnowledge(
  businessId: string,
  agentId: string | null,
  query: string,
  topK = 5,
): Promise<Array<{ content: string; score: number }>> {
  const queryEmbedding = await getQueryEmbedding(query);
  if (!queryEmbedding) return [];

  const rows = await db
    .select({
      content: knowledgeChunksTable.content,
      embedding: knowledgeChunksTable.embedding,
      docAgentId: knowledgeDocumentsTable.agentId,
    })
    .from(knowledgeChunksTable)
    .innerJoin(
      knowledgeDocumentsTable,
      eq(knowledgeChunksTable.documentId, knowledgeDocumentsTable.id),
    )
    .where(
      and(
        eq(knowledgeChunksTable.businessId, businessId),
        eq(knowledgeDocumentsTable.status, "ready"),
        agentId
          ? or(isNull(knowledgeDocumentsTable.agentId), eq(knowledgeDocumentsTable.agentId, agentId))
          : isNull(knowledgeDocumentsTable.agentId),
      ),
    );

  if (rows.length === 0) return [];

  const scored: Array<{ content: string; score: number }> = [];

  for (const row of rows) {
    if (!row.embedding) continue;

    let embeddingVec: number[];
    try {
      embeddingVec = JSON.parse(row.embedding) as number[];
    } catch {
      continue;
    }

    const score = cosineSimilarity(queryEmbedding, embeddingVec);
    scored.push({ content: row.content, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
