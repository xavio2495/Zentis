// `ansi-escapes` and Ink import Node's process for the platform check and the env. In a browser
// there is one platform, no environment, and no terminal program to detect.
const proc = { platform: "browser", env: {} as Record<string, string | undefined>, argv: [] as string[] };
export default proc;
export const platform = proc.platform;
export const env = proc.env;
export const cwd = () => "/";
export const argv = proc.argv;
export const exit = () => undefined;
export const stdout = undefined;
export const stderr = undefined;
