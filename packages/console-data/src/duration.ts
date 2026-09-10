/**
 * A duration as an operator says it, for the sentences this package writes.
 *
 * Ages here run from seconds to hours, and a caveat reading "the reference is 15238s old" makes the
 * reader do the arithmetic that decides whether to trust the quote above it.
 */
export function humanDuration(seconds: number): string {
	if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes}m`
	const hours = Math.floor(minutes / 60)
	const rest = minutes % 60
	return rest === 0 ? `${hours}h` : `${hours}h${rest}m`
}
