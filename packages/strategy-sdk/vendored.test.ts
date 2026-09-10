import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * `bun install` materialises a `file:` dependency as a copy, not a link. Every consumer therefore
 * runs the policy it last installed, and its own tests stay green against that stale copy. This
 * test fails when any installed copy differs from the source, so a policy change cannot land while
 * a workflow quietly keeps the old one.
 */
const ROOT = resolve(import.meta.dir, '..', '..')
const CONSUMERS = ['cre/fast', 'cre/slow', 'packages/console-data', 'apps/tui']
const SRC = join(ROOT, 'packages', 'strategy-sdk', 'src')

describe('every installed copy of the shared package matches its source', () => {
	for (const consumer of CONSUMERS) {
		const vendored = join(ROOT, consumer, 'node_modules', '@zentis', 'strategy-sdk', 'src')
		test(consumer, () => {
			if (!existsSync(vendored)) return // not installed here; nothing can be stale
			for (const file of readdirSync(SRC)) {
				expect(readFileSync(join(vendored, file), 'utf8')).toBe(readFileSync(join(SRC, file), 'utf8'))
			}
		})
	}
})
