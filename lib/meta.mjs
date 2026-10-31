import { validateCitations } from './verdict.mjs';
import { MetaApiError, JudgeError, isRetryableHttpStatus } from './errors.mjs';
import { VERDICTS } from './config.mjs';

// The only module that talks to Meta Model API.
// Config is read lazily: MetaClient is constructed with explicit values or
// from the environment at construction/call time — never frozen at import.
export function getModels(env = process.env) {
  return {
    spark: env.META_SPARK_MODEL || 'muse-spark-1.3',
    wonder: env.META_WONDER_MODEL || 'muse-wonder-1.0',
  };
}
const REQUIRED = ['META_MODEL_API_URL', 'META_MODEL_API_KEY'];
export function liveStatus(env = process.env) {
  const missing = REQUIRED.filter((k) => !env[k]);
  return { configured: missing.length === 0, missing };
}
export function metaMode(env = process.env) {
  return liveStatus(env).configured ? 'configured' : 'demo';
}

export function parseLiveVerdict(text, evidence) {
  let data;
  try { data = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new JudgeError('Live judge returned invalid JSON'); }
  if (!VERDICTS.includes(data.verdict)) throw new JudgeError(`Live judge returned unknown verdict: ${data.verdict}`);
  const check = validateCitations(data.citedIds || [], evidence || []);
  if (!check.ok) throw new JudgeError(`Live judge cited unknown evidence: ${check.bad.join(',')}`);
  const stances = {};
  for (const [id, s] of Object.entries(data.stances || {})) {
    if ((data.citedIds || []).includes(id) && ['supports', 'contradicts', 'misleading'].includes(s)) stances[id] = s;
  }
  return { verdict: data.verdict, citedIds: data.citedIds || [], stances, explanation: String(data.explanation || '') };
}

export class MetaClient {
  #apiUrl; #apiKey; #fetchImpl;
  /** @param {{ apiUrl?: string, apiKey?: string, spark?: string, wonder?: string, fetchImpl?: Function, env?: Record<string,string|undefined> }} [opts] */
  constructor({ apiUrl, apiKey, spark, wonder, fetchImpl, env } = {}) {
    const e = env || process.env;
    this.#apiUrl = apiUrl ?? e.META_MODEL_API_URL ?? '';
    this.#apiKey = apiKey ?? e.META_MODEL_API_KEY ?? '';
    this.models = {
      spark: spark ?? e.META_SPARK_MODEL ?? 'muse-spark-1.3',
      wonder: wonder ?? e.META_WONDER_MODEL ?? 'muse-wonder-1.0',
    };
    this.#fetchImpl = fetchImpl || fetch;
  }
  status() {
    const missing = [];
    if (!this.#apiUrl) missing.push('META_MODEL_API_URL');
    if (!this.#apiKey) missing.push('META_MODEL_API_KEY');
    return { configured: missing.length === 0, missing };
  }
  async #complete({ model, messages }) {
    const status = this.status();
    if (!status.configured) throw new MetaApiError(`Meta live mode not configured: missing ${status.missing.join(', ')}`);
    const res = await this.#fetchImpl(this.#apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.#apiKey}` },
      body: JSON.stringify({ model: model || this.models.spark, messages }),
    });
    if (!res.ok) throw new MetaApiError(`Meta Model API returned ${res.status}`, { retryable: isRetryableHttpStatus(res.status) });
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new MetaApiError('Meta Model API returned no message content');
    return content;
  }
  async completeJson({ model, system, user }) {
    const content = await this.#complete({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] });
    try { return JSON.parse(content); } catch { throw new JudgeError('Meta model returned invalid JSON'); }
  }
  async judge({ claim, evidence, model }) {
    const content = await this.#complete({
      model,
      messages: [
        { role: 'system', content: 'You are the TruthLens Evidence Judge. Reply with JSON only: {"verdict": one of ' + VERDICTS.join('|') + ', "citedIds": [evidence ids], "stances": {"<id>": "supports|contradicts|misleading"}, "explanation": string}. Cite only ids from the evidence given. Abstain with Unverifiable when evidence is insufficient.' },
        { role: 'user', content: `Claim: ${claim}\nEvidence:\n${(evidence || []).map((e) => `[${e.id}] (${e.stance}) ${e.passage}`).join('\n')}` },
      ],
    });
    return parseLiveVerdict(content, evidence);
  }
}

export function defaultMetaClient() {
  return new MetaClient();
}

// Back-compat for existing callers; prefer MetaClient / getModels.
export async function callLiveJudge({ claim, evidence, model }) {
  return defaultMetaClient().judge({ claim, evidence, model });
}
