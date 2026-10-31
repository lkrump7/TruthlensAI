import { StateGraph, START, END, Annotation, MemorySaver } from '@langchain/langgraph';
import { triageStage, researchStage, judgeStage, gateStage, challengeStage, assembleStage } from './stages.mjs';

// The agentic investigation workflow (LangGraph JS):
//   triage -> research -> judge -> gates -> challenge -> assemble
// Nodes are the exact stage functions the pipeline used before; the graph
// adds in-process checkpointed state (MemorySaver: per-thread, lost on
// restart, no resume endpoint yet), conditional short-circuits, and a
// recorded trajectory. Collaborators (search/fetch/judge/challenge) arrive
// via config.configurable.deps so graph state stays serializable.

const InvestigationState = Annotation.Root({
  text: Annotation(), type: Annotation(), research: Annotation(), stats: Annotation(),
  judgeEvidence: Annotation(), result: Annotation(), judgedBy: Annotation(), judges: Annotation(),
  cited: Annotation(), gated: Annotation(), challenge: Annotation(), preChallengeVerdict: Annotation(),
  final: Annotation(), verdict: Annotation(),
  trajectory: Annotation({ reducer: (a, b) => [...(/** @type {any[]} */ (a || [])), ...(/** @type {any[]} */ (b || []))], default: () => [] }),
});

const depsOf = (config) => config?.configurable?.deps || {};

const graph = new StateGraph(InvestigationState)
  .addNode('triage', async (state) => {
    const { type, final } = triageStage(state.text);
    return { type, final, verdict: final?.verdict, trajectory: ['triage'] };
  })
  .addNode('researchNode', async (state, config) => {
    const { research, stats, judgeEvidence, final } = await researchStage(state.text, state.type, depsOf(config));
    return { research, stats, judgeEvidence, final, verdict: final?.verdict, trajectory: ['research'] };
  })
  .addNode('judge', async (state, config) => {
    const { result, judgedBy, judges } = await judgeStage(state.text, state.judgeEvidence, depsOf(config));
    return { result, judgedBy, judges, trajectory: ['judge'] };
  })
  .addNode('gates', async (state) => {
    const { cited, gated } = gateStage(state.result, state.judgeEvidence);
    return { cited, gated, trajectory: ['gates'] };
  })
  .addNode('challengeNode', async (state, config) => {
    const out = await challengeStage(state.text, { cited: state.cited, gated: state.gated, result: state.result, judges: state.judges }, state.judgeEvidence, depsOf(config));
    return { ...out, trajectory: ['challenge'] };
  })
  .addNode('assemble', async (state) => {
    const final = assembleStage(state.text, state);
    return { final, verdict: final.verdict, trajectory: ['assemble'] };
  })
  .addEdge(START, 'triage')
  .addConditionalEdges('triage', (s) => (s.final ? END : 'researchNode'))
  .addConditionalEdges('researchNode', (s) => (s.final ? END : 'judge'))
  .addEdge('judge', 'gates')
  .addEdge('gates', 'challengeNode')
  .addEdge('challengeNode', 'assemble')
  .addEdge('assemble', END);

const checkpointer = new MemorySaver();
export const investigationGraph = graph.compile({ checkpointer });

let threadCounter = 0;
/** @param {string} text @param {Record<string, any>} [deps] @returns {Promise<any>} */
export async function runInvestigationGraph(text, deps = {}) {
  const ownThread = !deps.threadId;
  const threadId = deps.threadId || `investigation-${Date.now()}-${++threadCounter}`;
  try {
    const state = await investigationGraph.invoke(
      { text: String(text), trajectory: [] },
      { configurable: { thread_id: threadId, deps } },
    );
    const out = { ...(/** @type {Record<string, any>} */ (state.final || {})), trajectory: state.trajectory };
    if (deps._returnGraph) return { ...out, graph: investigationGraph, threadId };
    return out;
  } finally {
    // Caller-named threads belong to the caller and keep their
    // checkpoint. Auto-generated threads are single-use. Nothing can
    // resume them, since no caller knows the id and no resume endpoint
    // exists, so keeping them grows MemorySaver without bound. Delete
    // them. This deletion is the fix for that growth, not data loss.
    if (ownThread) await checkpointer.deleteThread(threadId).catch(() => {});
  }
}
