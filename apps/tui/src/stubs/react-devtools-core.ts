// Ink imports react-devtools-core behind a DEV-only guard, but the bundler hoists
// the dependency into the binary regardless. This stub keeps it out; the code path
// that would call it never runs outside a devtools session.
export default {
  initialize() {},
  connectToDevTools() {},
};
