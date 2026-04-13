/**
 * Autonomous Demand Agent
 *
 * Given a brief (goal, budget, constraints), the agent proposes demand
 * hypotheses, collects real-world signals, and loops until a hypothesis is
 * validated or the iteration/token budget is exhausted.
 *
 * Usage as a library:
 *   import { runAgent } from '@aida/demand-agent';
 *   const result = await runAgent({
 *     brief: { goal: '$20k in 60 days', budget: 100, skills: ['writing'] },
 *     onLog: console.log,
 *   });
 *
 * Usage as a CLI:
 *   demand-agent run ./brief.json
 *
 * Usage as a server:
 *   demand-agent-server (or npm start)
 */

export * from './types.js';
export * from './agent.js';
export {
  proposeHypotheses,
  scoreHypothesis,
  synthesizeLearnings,
  buildPlan,
} from './research.js';
export { fetchUrl, toExcerpt, urlsFromValidationPlan } from './signals.js';
