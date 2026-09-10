import { render } from "ink";
import { App } from "./App.js";

/**
 * The operator console.
 *
 * `ZENTIS_ENV` is a path to a private env file, never a key: it is handed to the child processes the
 * actions run and is neither read nor printed here. Without it the console still watches and still
 * re-quotes, and says so, because watching is most of the job and a demo machine should not need a
 * signing key to show the position.
 */
const envFile = process.env.ZENTIS_ENV ?? null;

render(<App envFile={envFile} />);
