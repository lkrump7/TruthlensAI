import { numbersIn } from './nlp.mjs';

// Independent verdict audit: deterministic checks over the final verdict,
// same rules for any claim. Audit notes never change the verdict; they
// join the limitations so over-certainty stays visible.
/**
 * @param {{ text?: string, verdict?: string, explanation?: string, cited?: any[], supporting?: any[], contradicting?: any[] }} [audit]
 */
export function auditVerdict({ text, verdict, explanation, cited, supporting, contradicting } = {}) {
  const notes = [];
  const citedList = cited || [];
  const expl = String(explanation || '');
  if (citedList.length && !citedList.some((e) => e.id && expl.includes(e.id))) {
    notes.push('Audit: the explanation references no cited passage by id; check the conclusion against the passages above.');
  }
  const figs = numbersIn(String(text || ''));
  if (figs.length && citedList.length) {
    const hay = citedList.map((e) => String(e.passage || '').toLowerCase()).join('\n');
    for (const f of [...new Set(figs)]) {
      if (!hay.includes(String(f).toLowerCase())) notes.push(`Audit: the claim's figure "${f}" appears in no cited passage; treat that quantity as unverified.`);
    }
  }
  if ((verdict === 'Supported' || verdict === 'Contradicted') && citedList.length === 1) {
    notes.push('Audit: a decisive verdict rests on a single cited passage; one more independent passage would make it solid.');
  }
  const sup = (supporting || []).length;
  const con = (contradicting || []).length;
  if (verdict === 'Supported' && sup > 0 && con >= sup) {
    notes.push('Audit: sizable counter-evidence exists; the verdict weighs the supporting passages as stronger.');
  }
  if (verdict === 'Contradicted' && con > 0 && sup >= con) {
    notes.push('Audit: sizable supporting evidence exists; the verdict weighs the contradicting passages as stronger.');
  }
  return notes;
}
