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
  /** null when the action can run; otherwise why it cannot, said plainly */
  readonly disabledReason: string | null
  /** null for actions the console performs itself rather than shelling out for */
  readonly command: ActionCommand | null
  readonly describe: string
}
