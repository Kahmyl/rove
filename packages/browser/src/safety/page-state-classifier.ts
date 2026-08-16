/**
 * Compatibility entrypoint for authoritative F1 browser perception.
 *
 * Production page-state perception is implemented only by
 * perception/page-state-decision. Operational decisions belong to Runtime F2
 * policy and must never be emitted from the browser package.
 */
export {
  classifyObservedPageState,
  type PageStateClassificationInput,
  type PageStateClassificationResult,
} from "../perception/page-state-decision.js";
