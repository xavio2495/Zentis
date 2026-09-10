import { describe, expect, test } from 'bun:test'
import { midFromUsdPrices } from './policy'

/**
 * Crowding is a mainnet quantity and has to be valued at a mainnet price. Valuing it at a testnet
 * leg's mid put Sepolia's venue at -9014 bps, because that pool sits fourteen times off the market.
 */
describe('a mid from two USD prices', () => {
	test('USDC at one dollar and WETH at 2,480 gives raw wei per 1e18 raw USDC', () => {
		// 1e18 raw USDC is 1e12 USDC, which buys 1e12 / 2480 WETH = 403,225,806.45 WETH in wei.
		expect(midFromUsdPrices('1', '2480', 6, 18)).toBe(403225806451612903225806451n)
	})

	test('decimal strings are read exactly, not through a float', () => {
		// Both prices scaled to 1e18 exactly, then 1e18 * A * 10^(18-6) / B.
		expect(midFromUsdPrices('0.9999433772089861', '2480.13345567', 6, 18)).toBe(
			(10n ** 18n * 999943377208986100n * 10n ** 12n) / 2480133455670000000000n,
		)
	})

	test('a pair with equal decimals needs no scale', () => {
		expect(midFromUsdPrices('2', '1', 18, 18)).toBe(2n * 10n ** 18n)
	})

	test('a zero or malformed price is no evidence', () => {
		expect(midFromUsdPrices('0', '2480', 6, 18)).toBe(0n)
		expect(midFromUsdPrices('abc', '2480', 6, 18)).toBe(0n)
	})
})
