import { z } from 'zod';

// Zod schemas with resource caps — the request-body contract for the verify
// route and the trust boundary shape for LLM output.

export const ParsedEntrySchema = z.object({
  key: z.string().min(1).max(256),
  type: z.string().min(1).max(64),
  title: z.string().max(512).optional(),
  authors: z.array(z.string().max(200)).max(100),
  year: z.number().int().min(1800).max(2100).optional(),
  venue: z.string().max(512).optional(),
  doi: z.string().max(256).optional(),
  arxivId: z.string().max(64).optional(),
  url: z.string().max(2048).optional(),
  // The server never reads fields/raw (they exist for client-side export);
  // the client omits them from the POST so long abstracts in real Zotero
  // exports cannot 400 the request. Caps still bound anything that IS sent.
  fields: z
    .record(z.string(), z.string().max(2048))
    .refine((o) => Object.keys(o).length <= 50, 'too many fields')
    .optional()
    .default({}),
  raw: z.string().max(8192).optional().default(''),
});

// Strip braces and collapse newlines so LLM text cannot smuggle BibTeX
// structure into serialized output.
const clean = (s: string) => s.replace(/[{}]/g, '').replace(/\s*\n\s*/g, ' ').trim();

export const LlmOutputSchema = z.object({
  // Verbose models overflow a hard cap and would fail the whole parse —
  // truncating keeps the explanation while still bounding it.
  explanation: z.string().transform((s) => s.slice(0, 500)),
  correctedEntry: z
    .object({
      title: z.string().max(512).transform(clean).optional(),
      authors: z.array(z.string().max(200).transform(clean)).max(100).optional(),
      year: z.number().int().min(1800).max(2100).optional(),
      venue: z.string().max(512).transform(clean).optional(),
      doi: z
        .string()
        .regex(/^10\.\d{4,9}\/\S+$/)
        .optional(),
    })
    .optional(),
});
