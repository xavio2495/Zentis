// Ink formats error stacks with stack-utils, which reaches for node:module. The browser build never
// renders that path, so the shim only has to satisfy the surface Ink touches while constructing it:
// the static `nodeInternals()` list of frames to hide, and `clean`.
export default class StackUtils {
  static nodeInternals(): RegExp[] {
    return [];
  }
  clean(stack: string): string {
    return stack;
  }
  parseLine(): null {
    return null;
  }
}
