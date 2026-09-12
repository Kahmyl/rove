// The locked L0 oracle and production import share one implementation.
// Reviewed changes are made in the generated production authority; this direct
// re-export plus the production function-identity test makes drift observable.
export * from "../../packages/protocol/src/native-lifecycle-contract.generated.ts";
