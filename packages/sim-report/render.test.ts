import { describe, expect, test } from 'bun:test'
import { renderMarkdown, type Report } from './render'
import latest from './results/latest.json'

describe('sim-report renders the committed run, and nothing else', () => {
	test('every regime in the artefact becomes one row, and the caption names the commit', () => {
		const report = latest as Report
		const md = renderMarkdown(report)
		const rows = md.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Regime'))
		expect(rows).toHaveLength(report.regimes.length)
		expect(md).toContain(report.modelCommit.slice(0, 12))
	})

	test('a row carries mean, deviation, worst and the seeds-ahead ratio verbatim', () => {
		const report: Report = {
			modelCommit: 'abcdef1234567890',
			generatedAt: '2026-09-10T00:00:00+00:00',
			unit: 'raw tokenA',
			bookInA: 60_000_000,
			regimes: [
				{ regime: 'trend', trendBps: 300, volBpsPerTick: 25, seeds: 24, meanVsStatic: 178618, sdVsStatic: 19621, worstVsStatic: 151256, seedsAhead: 24, meanBookDrift: 0.0139, meanVsStaticBpsOfBook: 29.8, worstVsStaticBpsOfBook: 25.2 },
			],
		}
		expect(renderMarkdown(report)).toContain('| trend | 300 bps | 25 bps | 178,618 | 29.8 bps | 19,621 | 151,256 | 24/24 | 0.0139 |')
	})
})
