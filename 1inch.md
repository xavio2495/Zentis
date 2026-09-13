# 1inch, in this repository

### The three instructions, at reserved SwapVM opcode slots
[`contracts/src/instructions/ZentisSkew.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/src/instructions/ZentisSkew.sol) ·
[`contracts/src/instructions/ZentisSpread.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/src/instructions/ZentisSpread.sol) ·
[`contracts/src/instructions/ZentisBand.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/src/instructions/ZentisBand.sol)

### Nine lines of dispatcher over unmodified Aqua and SwapVM
[`contracts/src/opcodes/ZentisOpcodes.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/src/opcodes/ZentisOpcodes.sol) ·
[`contracts/src/routers/ZentisRouter.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/src/routers/ZentisRouter.sol) ·
[`.gitmodules`](https://github.com/xavio2495/Zentis/blob/main/.gitmodules)

### One effective tilt, so the guard and the price can never disagree
[`contracts/src/libs/ZentisTiltLib.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/src/libs/ZentisTiltLib.sol) ·
[`contracts/src/instructions/ZentisContextLib.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/src/instructions/ZentisContextLib.sol)

### A third vetted recipe, in `Strategies.sol`'s own shape
[`contracts/src/strategies/ZentisStrategies.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/src/strategies/ZentisStrategies.sol) ·
[`contracts/script/ZentisPositionConfig.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/script/ZentisPositionConfig.sol)

### The reference the instructions price from
[`contracts/src/ref/ZentisRefRegistry.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/src/ref/ZentisRefRegistry.sol) ·
[`contracts/src/ref/IZentisRef.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/src/ref/IZentisRef.sol)

### Deploying the venue from pinned source, and shipping onto it
[`contracts/script/DeployVenue.s.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/script/DeployVenue.s.sol) ·
[`contracts/script/Deploy.s.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/script/Deploy.s.sol) ·
[`contracts/script/ShipPosition.s.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/script/ShipPosition.s.sol)

### Quoting and filling a real position, and the bytes a console can reuse
[`contracts/script/Quote.s.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/script/Quote.s.sol) ·
[`contracts/script/Fill.s.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/script/Fill.s.sol) ·
[`contracts/script/EncodeFill.s.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/script/EncodeFill.s.sol)

### The direction table, the over-quote proof, and quote/swap parity
[`contracts/test/unit/ZentisSkew.t.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/test/unit/ZentisSkew.t.sol) ·
[`contracts/test/integration/ZentisPosition.t.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/test/integration/ZentisPosition.t.sol) ·
[`contracts/test/fixtures/ZentisProgramHarness.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/test/fixtures/ZentisProgramHarness.sol)

### SwapVM's own `CoreInvariants`, run against the program that is deployed
[`contracts/test/invariant/ZentisPositionInvariants.t.sol`](https://github.com/xavio2495/Zentis/blob/main/contracts/test/invariant/ZentisPositionInvariants.t.sol)

### Pricing the rebalancing budget against a real Fusion+ quote
[`cre/slow/workflow.ts`](https://github.com/xavio2495/Zentis/blob/main/cre/slow/workflow.ts) ·
[`cre/slow/policy.ts`](https://github.com/xavio2495/Zentis/blob/main/cre/slow/policy.ts)

### Reading the venue back: every maker's Aqua position, decoded
[`subgraphs/aqua-standard/src/program.ts`](https://github.com/xavio2495/Zentis/blob/main/subgraphs/aqua-standard/src/program.ts) ·
[`subgraphs/aqua-standard/src/dialect.ts`](https://github.com/xavio2495/Zentis/blob/main/subgraphs/aqua-standard/src/dialect.ts) ·
[`subgraphs/aqua-standard/src/classify.ts`](https://github.com/xavio2495/Zentis/blob/main/subgraphs/aqua-standard/src/classify.ts)

### Asking the router itself what it would pay, and decoding its refusals
[`services/quote-api/src/quote.ts`](https://github.com/xavio2495/Zentis/blob/main/services/quote-api/src/quote.ts) ·
[`services/quote-api/src/refusal.ts`](https://github.com/xavio2495/Zentis/blob/main/services/quote-api/src/refusal.ts) ·
[`services/quote-api/src/takerTraits.ts`](https://github.com/xavio2495/Zentis/blob/main/services/quote-api/src/takerTraits.ts)

---

**The opcodes.** `ZentisSkew` `0x9e` (62-byte payload, mutates `balanceIn` only) · `ZentisSpread`
`0x9f` (86 bytes, a wrapper applying the half-spread as a dynamic fee) · `ZentisBand` `0xb3`
(56 bytes, a wrapper bounding the realised price against the reference). Seven reachable entries in
the table: `Deadline`, `Salt`, `FeeProtocol`, `XYCSwap` and those three.

**Official contracts, unmodified.** `1inch/swap-vm` at `f09a41e` and `1inch/aqua` at `9c5c42e`, pinned
as git submodules and byte-identical to upstream. The diff against stock is three instruction
libraries, one shared tilt library and a nine-line `_runOpcode`. Instruction, opcode and router files
carry `LicenseRef-Degensoft-SwapVM-1.1` rather than this repository's licence, because the Degensoft
licence defines an instruction program in the same EVM address space as a Modified Work.

**Powered by Aqua — © Degensoft Ltd 2025.**
