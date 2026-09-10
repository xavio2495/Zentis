/**
 * A reader never throws on a dead endpoint.
 *
 * The console has to keep drawing when one of five sources is down, and it has to say which one and
 * why, so every reader returns its failure as a string the screen can print rather than as an
 * exception the screen has to catch. `indexingErrors` is carried separately: a subgraph that
 * answers while behind is not an error, but the answer is not the chain either.
 */
export interface Read<T> {
  readonly value: T | null;
  readonly error: string | null;
  readonly indexingErrors: boolean;
}

export const failed = <T>(error: string): Read<T> => ({ value: null, error, indexingErrors: false });

export const ok = <T>(value: T, indexingErrors = false): Read<T> => ({
  value,
  error: null,
  indexingErrors,
});

const TIMEOUT_MS = 15_000;

/**
 * `_meta { hasIndexingErrors }` is asked for on every query rather than separately, because a
 * second round trip would report the health of a different block from the one that answered.
 */
export async function query<T>(url: string, body: string): Promise<Read<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: `{ _meta { hasIndexingErrors } ${body} }` }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    return failed(`could not reach the subgraph: ${String(cause)}`);
  }
  if (!response.ok) {
    // Subgraph Studio's allowance is per deployment endpoint over a window of hours, so the reset
    // time is the only part of a refusal anyone can act on. Backing off without it is guesswork.
    const reset = response.headers.get("x-ratelimit-reset");
    const when =
      reset === null ? "" : `, resets ${new Date(Number(reset) * 1000).toISOString().slice(11, 16)}Z`;
    return failed(`subgraph HTTP ${response.status}${when}`);
  }

  let payload: { data?: T & { _meta?: { hasIndexingErrors: boolean } }; errors?: { message: string }[] };
  try {
    payload = (await response.json()) as typeof payload;
  } catch (cause) {
    return failed(`the subgraph's answer was not json: ${String(cause)}`);
  }
  if (payload.errors !== undefined && payload.errors.length > 0) {
    return failed(payload.errors.map((e) => e.message).join("; "));
  }
  if (payload.data === undefined || payload.data === null) return failed("the subgraph returned no data");

  return ok(payload.data, payload.data._meta?.hasIndexingErrors === true);
}

/** Reads a value that is absent rather than wrong when a source has nothing to say. */
export async function json<T>(url: string): Promise<Read<T>> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return failed(`${url} answered ${response.status}`);
    return ok((await response.json()) as T);
  } catch (cause) {
    return failed(`could not reach ${url}: ${String(cause)}`);
  }
}
