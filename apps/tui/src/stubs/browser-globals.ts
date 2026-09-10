// Imported first by the browser entry, so that it runs before any module body that reads `process`.
// The data layer takes endpoint overrides from the environment; in a browser there is none, and an
// empty one makes those reads fall through to their defaults, which is what a public build wants.
const globals = globalThis as unknown as { process?: unknown };
globals.process ??= { env: {}, argv: [], platform: "browser" };
export {};
