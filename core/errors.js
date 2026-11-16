export class RuleError extends Error {}
export const fail = (msg) => { throw new RuleError(msg); };
