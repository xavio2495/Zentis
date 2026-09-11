/**
 * What the screen needs to know about an action, with none of the machinery for running one.
 *
 * Split out so the browser build can present the same actions row without pulling `node:path` and
 * `Bun.spawn` into a bundle that has neither. The site shows the operator's real keys, disabled,
 * which is a truer picture of the product than hiding them would be.
 */
export interface ActionCommand {
  readonly cmd: string[]
  readonly cwd: string
  /** extra environment for the child; never contains anything read from the env file */
  readonly env?: Record<string, string>
}

export interface Action {
  readonly key: string
  readonly label: string
  /** one word for the hint row, where the full label does not fit and a bare letter says nothing */
  readonly short: string
  /** null when the action can run; otherwise why it cannot, said plainly */
  readonly disabledReason: string | null
  /**
   * What is in the way, so the screen can pitch it. `env` is watch-only by choice — no signing key
   * was given — and is not a warning to someone who only wants to watch. `repo` is an operator who
   * did give a key but is running from somewhere the scripts cannot be found, and is worth saying.
   */
  readonly blocker: "env" | "repo" | null
  /** null for actions the console performs itself rather than shelling out for */
  readonly command: ActionCommand | null
  readonly describe: string
}
