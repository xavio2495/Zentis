// A stand-in for a Node builtin that is imported but never called on any path the browser reaches.
export const builtinModules: string[] = [];
export default { builtinModules };
