// ---------------------------------------------------------------------------
// RAG — Retrieval Augmented Generation for Soroban security audits
//
// Embeddings: @xenova/transformers (all-MiniLM-L6-v2, runs locally in Node.js)
// Vector store: in-memory cosine similarity — no external service needed
// ---------------------------------------------------------------------------

import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";
import { DOCS } from "./docs.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Chunk {
  docId: string;
  heading: string;
  text: string;
  embedding: Float32Array;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let embedder: FeatureExtractionPipeline | null = null;
const chunks: Chunk[] = [];
let indexReady = false;

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!embedder) {
    console.log("  [RAG] Loading embedding model (Xenova/all-MiniLM-L6-v2)...");
    embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
      // Suppress verbose HF progress output
      progress_callback: undefined,
    }) as FeatureExtractionPipeline;
    console.log("  [RAG] Embedding model ready.");
  }
  return embedder;
}

async function embed(text: string): Promise<Float32Array> {
  const fn = await getEmbedder();
  const output = await fn(text, { pooling: "mean", normalize: true });
  // output.data is a Float32Array of the embedding vector
  return output.data as Float32Array;
}

// ---------------------------------------------------------------------------
// Chunking — split each doc by "## " heading boundaries
// ---------------------------------------------------------------------------

function chunkDoc(docId: string, content: string): Array<{ heading: string; text: string }> {
  const sections = content.split(/\n(?=## )/);
  return sections
    .map((section) => {
      const lines = section.trim().split("\n");
      const heading = lines[0].replace(/^#+\s*/, "").trim();
      const text = section.trim();
      return { heading, text };
    })
    .filter((s) => s.text.length > 50); // skip trivially short sections
}

// ---------------------------------------------------------------------------
// Index build — call once at server startup
// ---------------------------------------------------------------------------

export async function buildIndex(): Promise<void> {
  if (indexReady) return;

  console.log(`  [RAG] Building index over ${DOCS.length} knowledge documents...`);
  const start = Date.now();

  for (const doc of DOCS) {
    const sections = chunkDoc(doc.id, doc.content);
    for (const section of sections) {
      const embedding = await embed(section.text);
      chunks.push({
        docId: doc.id,
        heading: section.heading,
        text: section.text,
        embedding,
      });
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  [RAG] Index built: ${chunks.length} chunks in ${elapsed}s`);
  indexReady = true;
}

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Retrieve — returns top-k relevant chunks as formatted strings
// ---------------------------------------------------------------------------

export async function retrieve(query: string, topK = 4): Promise<string[]> {
  if (!indexReady || chunks.length === 0) {
    // Graceful fallback: index not ready, return empty (audit still runs without RAG)
    return [];
  }

  const queryEmbedding = await embed(query);

  const scored = chunks.map((chunk) => ({
    chunk,
    score: cosine(queryEmbedding, chunk.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored
    .slice(0, topK)
    .map(({ chunk }) => `### ${chunk.heading}\n\n${chunk.text}`);
}
