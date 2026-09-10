// Only the EOL is ever read on the paths the browser bundle reaches.
const os = { EOL: "\n", platform: () => "browser" };
export default os;
export const EOL = os.EOL;
