import { buildInvestigationReport } from '../../../lib/export.mjs';

// Returns the investigation report for a verdict record as a Markdown
// download. Server-side so prompts and pipeline code stay off the client.
export async function POST(req) {
  const { record } = await req.json().catch(() => ({}));
  if (!record || !record.text) return Response.json({ error: 'No investigation to export.' }, { status: 400 });
  const md = buildInvestigationReport(record);
  return new Response(md, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': 'attachment; filename="truthlens-investigation.md"',
    },
  });
}
