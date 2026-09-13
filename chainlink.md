# Chainlink, in this repository

### The fast workflow — one mid for the whole book, three legs, one instant
[`cre/fast/workflow.ts`](https://github.com/xavio2495/Zentis/blob/main/cre/fast/workflow.ts) ·
[`cre/fast/main.ts`](https://github.com/xavio2495/Zentis/blob/main/cre/fast/main.ts) ·
[`cre/fast/config.staging.json`](https://github.com/xavio2495/Zentis/blob/main/cre/fast/config.staging.json)

### The slow workflow — the spread, the adverse-selection term and the rebalancing budget
[`cre/slow/workflow.ts`](https://github.com/xavio2495/Zentis/blob/main/cre/slow/workflow.ts) ·
[`cre/slow/policy.ts`](https://github.com/xavio2495/Zentis/blob/main/cre/slow/policy.ts) ·
[`cre/slow/config.staging.json`](https://github.com/xavio2495/Zentis/blob/main/cre/slow/config.staging.json)

### The TEE constraint, pinned rather than permissive
[`cre/fast/workflow.ts`](https://github.com/xavio2495/Zentis/blob/main/cre/fast/workflow.ts#L398) ·
[`cre/slow/workflow.ts`](https://github.com/xavio2495/Zentis/blob/main/cre/slow/workflow.ts#L662)

### The receiver the report lands in, and why a rejection does not revert
[`contracts/src/ref/ZentisRefRegistry.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/src/ref/ZentisRefRegistry.sol) ·
[`contracts/src/ref/IZentisRef.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/src/ref/IZentisRef.sol) ·
[`contracts/lib/cre-receiver/src/ReceiverTemplate.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/lib/cre-receiver/src/ReceiverTemplate.sol)

### The report, consumed on chain at the moment a taker fills
[`contracts/src/instructions/ZentisSkew.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/src/instructions/ZentisSkew.sol) ·
[`contracts/src/instructions/ZentisSpread.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/src/instructions/ZentisSpread.sol) ·
[`contracts/src/instructions/ZentisBand.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/src/instructions/ZentisBand.sol)

### What the enclave keeps, declared by name and never by value
[`cre/secrets.yaml`](https://github.com/xavio2495/Zentis/blob/main/cre/secrets.yaml) ·
[`cre/.env.example`](https://github.com/xavio2495/Zentis/blob/main/cre/.env.example) ·
[`packages/strategy-sdk/src/policy.ts`](https://github.com/xavio2495/Zentis/blob/main/packages/strategy-sdk/src/policy.ts)

### Determinism, asserted because no attestation is checking it
[`cre/fast/workflow.test.ts`](https://github.com/xavio2495/Zentis/blob/main/cre/fast/workflow.test.ts) ·
[`cre/slow/workflow.test.ts`](https://github.com/xavio2495/Zentis/blob/main/cre/slow/workflow.test.ts)

### The capability budget — written, tested, and deliberately not wired
[`cre/fast/workflow.ts`](https://github.com/xavio2495/Zentis/blob/main/cre/fast/workflow.ts#L426) ·
[`cre/slow/workflow.ts`](https://github.com/xavio2495/Zentis/blob/main/cre/slow/workflow.ts#L691)

### The Price Feed as a bound on the enclave's own output, never as a price
[`contracts/src/ref/ZentisRefRegistry.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/src/ref/ZentisRefRegistry.sol) ·
[`contracts/lib/chainlink-interfaces/src/AggregatorV3Interface.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/lib/chainlink-interfaces/src/AggregatorV3Interface.sol) ·
[`contracts/test/fixtures/MockAggregatorV3.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/test/fixtures/MockAggregatorV3.sol)

### Publishing on a schedule, with one signing key and no nonce race
[`scripts/publisher.sh`](https://github.com/xavio2495/Zentis/blob/main/scripts/publisher.sh) ·
[`scripts/publisher.test.sh`](https://github.com/xavio2495/Zentis/blob/main/scripts/publisher.test.sh) ·
[`deploy/cloudrun/tick.sh`](https://github.com/xavio2495/Zentis/blob/main/deploy/cloudrun/tick.sh)

### The registry's guards, tested
[`contracts/test/unit/ZentisRefRegistry.t.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/test/unit/ZentisRefRegistry.t.sol)

---

**Two workflows, because determinism forbids one.** The fast workflow is strictly deterministic over
pinned block data and owns `mid`, `tiltBps`, `dTiltPerA`, `refBalanceA`, `maxExtrapBps`, `updatedAt`
and `seq`. The slow workflow is hourly, bucketed to the nearest basis point, and owns `spreadBps`,
`markoutBps` and `bandEdgeBps` through a read-modify-write. A live quote endpoint would return a
different answer on every call, so the Fusion+ read that prices the rebalancing budget sits on the
slow side only.

**What is confidential, stated honestly.** `KAPPA_BPS` and `KAPPA_BOOK_BPS` — the gains that turn
inventory into a quote concession, and the numbers whose leak would let an operator position ahead of
every rebalance — plus `CONGESTION_BPS`, the 1inch API key and the Fusion+ quote payload, whose size
and direction are exactly what a front-runner would want. The market price, the Aqua balances and the
published reference are **not** secret: they are public data, they cross back out through
`usingTheDons()` because the EVM capability needs a DON runtime, and claiming otherwise would be
theatre.

**Zero `runtime.log()` inside either enclave**, enforced by a test rather than promised.

**The three things the production-shaped templates get wrong**, done deliberately here: the TEE
constraint is pinned to `[{ tee: 'nitro', regions: ['us-west-2'] }]` rather than left permissive;
nothing is logged from inside the enclave; and the capability budget is sized for the **worst** single
execution with real headroom — every published limit doubled, scaling with the number of legs. That
budget cannot currently be wired in, because any workflow supplying a `preHook` fails to execute on
cre-sdk 1.20.0 / CLI v1.32.0. It ships as an exported, unit-tested function with the reason in a
comment. See [`FEEDBACK.md`](./FEEDBACK.md) §3.1 and
[smartcontractkit/cre-sdk-typescript#314](https://github.com/smartcontractkit/cre-sdk-typescript/issues/314).

**Confidentiality is modelled in simulation, not enforced.** Deploy access was never granted to this
organisation, so both workflows have only ever run under `cre workflow simulate` — a single-node local
simulator that produces no attestation. Reports reach the three registries through a mock Keystone
forwarder, which verifies that one named contract is the caller but verifies **no DON signature**: on
these testnets anyone who calls it can write a reference. `goLive()` is deliberately uncalled. The
full disclosure, and what a real DON deployment would change, is in
[`docs/CRE_CONTINGENCY.md`](https://github.com/xavio2495/Zentis/blob/main/docs/CRE_CONTINGENCY.md).

**The Price Feed bound is implemented, tested and shipped disabled.** `ZentisRefRegistry` can reject a
report whose `mid` deviates more than `FEED_BAND_BPS` from a Chainlink Price Feed — a bound on the
*reference*, answering "what if the enclave is compromised", with the feed never touching pricing.
`FEED` is `immutable`, and the legs were re-based onto a real market mid late in the build, so
enabling it now would mean new registries, new strategy hashes, a re-ship and new subgraph manifests.
All three feeds are live and contract-readable and now agree with the reference to within 20 bps:

| Chain | ETH/USD feed | Read |
|---|---|---|
| Sepolia | `0x694AA1769357215DE4FAC081bf1f309aDC325306` | $2465.98 |
| Base Sepolia | `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1` | $2465.88 |
| Arbitrum Sepolia | `0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165` | $2466.12 |

*(`latestRoundData` over each chain's public RPC, 2026-09-11.)*
