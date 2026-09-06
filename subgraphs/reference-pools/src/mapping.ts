import { Address, BigInt, dataSource } from "@graphprotocol/graph-ts";
import { Swap as SwapEvent } from "../generated/Pool/UniswapV3Pool";
import { ERC20 } from "../generated/Pool/ERC20";
import { Pool, Swap } from "../generated/schema";

// mid = raw tokenB per 1e18 raw tokenA (cg1/PRODUCT_TECH_SPEC.md §1), derived from Uniswap's
// sqrtPriceX96 (Q64.96 encoding of sqrt(token1/token0) in raw-unit terms). tokenA/tokenB here are
// always token0/token1 respectively — both tracked pools happen to have tokenA = token0 already
// (checked on-chain, see docs/DECISIONS.md), so no reordering is needed.
function midFromSqrtPriceX96(sqrtPriceX96: BigInt): BigInt {
  const numerator = sqrtPriceX96.times(sqrtPriceX96).times(BigInt.fromI32(10).pow(18));
  const denominator = BigInt.fromI32(2).pow(192);
  return numerator.div(denominator);
}

export function handleSwap(event: SwapEvent): void {
  const poolId = event.address.toHexString();
  let pool = Pool.load(poolId);
  if (pool == null) {
    pool = new Pool(poolId);
    const context = dataSource.context();
    pool.tokenA = context.getBytes("tokenA");
    pool.tokenB = context.getBytes("tokenB");
  }

  pool.sqrtPriceX96 = event.params.sqrtPriceX96;
  pool.tick = BigInt.fromI32(event.params.tick);
  pool.liquidity = event.params.liquidity;
  pool.mid = midFromSqrtPriceX96(event.params.sqrtPriceX96);

  const tokenA = ERC20.bind(Address.fromBytes(pool.tokenA));
  const tokenB = ERC20.bind(Address.fromBytes(pool.tokenB));
  const reserveA = tokenA.try_balanceOf(event.address);
  const reserveB = tokenB.try_balanceOf(event.address);
  pool.reserveA = reserveA.reverted ? pool.reserveA : reserveA.value;
  pool.reserveB = reserveB.reverted ? pool.reserveB : reserveB.value;

  pool.updatedAtBlock = event.block.number;
  pool.updatedAtTimestamp = event.block.timestamp;
  pool.save();

  const swap = new Swap(event.transaction.hash.toHexString() + ":" + event.logIndex.toString());
  swap.pool = poolId;
  swap.sender = event.params.sender;
  swap.recipient = event.params.recipient;
  swap.amount0 = event.params.amount0;
  swap.amount1 = event.params.amount1;
  swap.sqrtPriceX96 = event.params.sqrtPriceX96;
  swap.liquidity = event.params.liquidity;
  swap.tick = BigInt.fromI32(event.params.tick);
  swap.blockNumber = event.block.number;
  swap.timestamp = event.block.timestamp;
  swap.save();
}
