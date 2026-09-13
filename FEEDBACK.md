# Developer experience feedback — 1inch · The Graph · Chainlink

Found while building **Zentis**, a single market-making position that runs on three chains and
rebalances by pricing rather than bridging. Everything below was hit in the eight days of the build,
on the versions named in each section. Each item says what happened, why it cost time, and what would
fix it.

Two rules for this document. **Nothing is reported that was not reproduced** — where we first drew a
wrong conclusion and later corrected it, the correction is written down rather than the original
claim. And **the praise is specific**, because "great docs" helps nobody.

Bugs filed upstream while building:

| | Upstream |
|---|---|
| CRE `preHook` breaks execution | [smartcontractkit/cre-sdk-typescript#314](https://github.com/smartcontractkit/cre-sdk-typescript/issues/314) |
| CRE `TestTeeRuntime` unreachable | [#315](https://github.com/smartcontractkit/cre-sdk-typescript/issues/315), fixed by [PR #316](https://github.com/smartcontractkit/cre-sdk-typescript/pull/316) |

---

# 1inch — Aqua / SwapVM

Versions: `1inch/swap-vm@f09a41e` and `1inch/aqua@9c5c42e` as pinned submodules, Solidity `0.8.30`
exact, Foundry `v1.7.1`. Also read: the deployed mainnet router at `v1.0.2`, and
`1inch/sdks/typescript/aqua` at `cf377ec`.

## 1.1 The router extension API changed three times in six weeks, and the README documents a dead one

`_instructions()` → `_opcodes()` → `_dispatch` / `_runOpcode`. All three appear in public prize-winning
code from the last two hackathons, and the repository's own README still described the first.

This is the single most expensive thing in the integration, because the failure is not a compile
error — a hook that no longer exists simply never gets called, and the router silently falls through
to stock behaviour. We adopted a rule ("never guess an API; open the pinned submodule and read the
header") specifically to survive it.

**Fix:** a `MIGRATION.md` with the three eras and their dates, and a version table at the top of the
README. Even three lines would have been enough.

## 1.2 The deployed router does not use the opcode table in the repository — and decoding against the wrong one succeeds

This is the one that nearly shipped a wrong answer.

| | Pinned source (`f09a41e`) | Deployed mainnet router (`v1.0.2`) |
|---|---|---|
| Constant-product swap | `0x50` | **`17`** |
| Flat fee in | `0x70` | **`21`** |
| Numbering scheme | banked hex enum | flat contiguous decimal |
| Fee denominator (`feeBps`) | `1e7` | **`1e9`** |
| Token location | `data[0:20]`, `data[20:40]` per `MakerTraits.build` | **not in `data`** — tokens are arguments to `ship()` |

Decoding a live position with the source table yields `0x11` → `PrintSwapQuery`, `0x12` → `PrintVM`.
That is a plausible-looking answer and it is entirely wrong. A wrong opcode number is not an error; it
is a different instruction.

We only caught it because our subgraph refuses to decode an app whose table is not known from verified
source. Triple-verified afterwards against the `v1.0.2` dispatch array, the published opcode gallery,
and six instructions decoded byte-exactly out of two live mainnet blobs.

**Fix:** publish the opcode table as data — a JSON file per release tag, or a view function on the
router returning its own table. Anyone indexing Aqua has to solve this, and everyone will solve it
differently and wrongly.

**The general rule this taught us**, which is worth stating in the docs: *the opcode table is a
property of the deployed contract, not of the repository.* Verify against HEAD for code you compile;
verify against deployed bytecode for anything you index.

## 1.3 `_opcodes()` builds a 35-entry array and reinterprets it as 34, so every instruction is one slot below where it is written

`AquaOpcodes._opcodes()` builds a 35-entry static array, then overwrites entry 0 with the array length
to turn it into a 34-entry dynamic array. Reading the source array literally gives a table that is off
by one at **every** entry.

It is a neat trick and it is invisible to a reader who has not seen it before. One comment on that
line would save every integrator an afternoon.

## 1.4 The pinned submodule does not compile on its own

`swap-vm`'s sources import `@1inch/solidity-utils/...` and `@1inch/aqua/...`, which Foundry's
auto-detected remappings resolve to `lib/swap-vm/node_modules/@1inch/...` — a directory that does not
exist in a fresh submodule checkout, because nothing ran `npm install`.

**Fix:** ship a `remappings.txt` in the repository, or document the two lines needed. We compiled the
stock `AquaSwapVMRouter` before writing a line of our own code specifically to flush this out, and it
was the right call.

## 1.5 `FeeProtocol` needs `resolveShrink()`, and `Strategies.sol` teaches you the opposite

`FeeProtocol.sizeOf` unconditionally reserves 27 bytes for a surplus estimate that `build()` only emits
when a receiver takes a surplus fee. `MemoryPtrLib.resolve` requires an exactly-filled buffer, so any
composed recipe containing `FeeProtocol` reverts with `MemoryPtrStrictResolveFailed(862, 832)`.

`FeeProtocol.build` itself uses `resolveShrink` for this reason. But `Strategies.sol` — the file you are
told to copy the shape of — contains two recipes, **neither of which uses `FeeProtocol`**, so both use
`resolve()`. Copying the vetted example is what produces the bug.

Related: `FeeProtocol.build` reverts `FeeProtocolNoFeeFlagsSet` on a receiver with neither flag set, so
a zero fee must be *omitted from the program*, not encoded as zero.

**Fix:** one comment in `Strategies.sol` saying a recipe with a loose `sizeOf` must resolve shrinking.

## 1.6 Every Aqua event has zero indexed parameters

```solidity
event Shipped(address maker, address app, bytes32 strategyHash, bytes strategy);
event Docked(address maker, address app, bytes32 strategyHash);
event Pulled (address maker, address app, bytes32 strategyHash, address token, uint256 amount);
event Pushed (address maker, address app, bytes32 strategyHash, address token, uint256 amount);
```

`SwapVM.Swapped` is the same. So nothing can be filtered by maker, app or token through `eth_getLogs`
topics, and every consumer must ingest and decode the whole venue to answer "what is this maker doing".

We do not think this is a mistake — it is the reason our standardized subgraph exists, and we say so
in the README. But it is worth being deliberate about: indexing `maker` and `app` would cost one topic
slot each and would make simple integrations possible without a subgraph at all.

## 1.7 `dock()` burns a strategy hash permanently, and nothing warns you

`ship()` requires `balance.tokensCount == 0`; `dock()` writes the permanent `0xff` `_DOCKED` sentinel.
So an identical order can never be shipped twice — a re-ship with unchanged parameters reverts
`StrategiesMustBeImmutable`.

We found this the third time we re-shipped, when the only change we wanted was inventory. The lesson is
good design (it is *why* mutable parameters belong in a feed the program reads, not in immediates) but
it deserves a sentence in `PROGRAMS.md`, because the natural operational instinct — dock, fix, re-ship
— hits it immediately.

The corollary that is genuinely delightful and also undocumented: **`ship()` and `dock()` move no
tokens at all.** Aqua's own token balance is zero; settlement pulls from the maker's wallet against
their approval. We verified this by reading balances rather than assuming. "Funds never leave your
wallet" is literal, and it is the most sellable property of the venue. Lead with it.

## 1.8 Aqua bounds commitments per strategy, but not across strategies against the wallet balance

One `approve(aqua, max)` backs every strategy a maker has shipped. Aqua bounds the total per strategy
and does not bound the sum across strategies against the actual wallet balance. A maker with several
positions can over-commit: whichever swap lands first wins, and the rest revert at `transferFrom`.

Nothing in Aqua detects it and nothing in our own design did either until we went looking. It is a real
foot-gun for exactly the multi-position maker Aqua is built for.

**Fix:** a view returning total committed per token across a maker's active strategies. It does not have
to be enforced to be useful.

## 1.9 Smaller things

- **`SwapVM.quote` is not `view`**, so a stateful wrapper will silently write storage. The `asView()`
  cast is the correct path and it is easy to miss; ours is enforced by a quote/swap parity test.
- **`OraclePriceAdjuster` divides by `amountIn` with no zero guard**, and treats `maxStaleness = 0` as
  "disabled". We took the opposite convention (`0` rejects) deliberately, because a config that reads
  as "off" should never be the one that disables a safety check.
- **`Extruction` (0x04)** is an arbitrary-external-call escape hatch sitting in the stock 16-entry
  table. We dropped it along with eight other unreachable instructions; our 7-entry router came out at
  **17,061 bytes** against EIP-170's 24,576, *smaller* than the stock router carrying none of our code.
  Worth documenting that trimming the table is the expected move for an app router.
- **`TESTING.md` lists ~45 invariant tests and skips symmetry, additivity and monotonicity** for
  several compositions with open TODOs, including a literal *"why it didn't fail?"*. We ran the
  `CoreInvariants` suite against our own program and hit the additivity one for a real reason (below),
  so those TODOs are load-bearing.
- **The TypeScript SDK does cover custom opcodes** — the base `ProgramBuilder` takes an `ixsSet` and
  derives the on-chain byte from array position. This is documented in the SDK README and was the one
  thing we expected to need a PR for and did not. `AquaProgramBuilder` being hardcoded to the stock
  table is correctly flagged as not-for-custom-deployments. `push()` / `pull()` have no typed wrapper
  and exist only in the raw ABI — a small, clean PR opportunity.

## What works well

- **`_dispatch` / `_runOpcode` as a virtual hook is the right shape.** Extending the VM is one
  contract, nine lines, and no fork. Our entire mechanism is three instruction libraries and a
  dispatcher, against completely unmodified Aqua and SwapVM.
- **Aqua's non-custodial model is the best thing in the stack** and is under-sold. Funds stay in the
  maker's wallet, `dock()` revokes instantly, and `push()` tops a live position up with no dock and no
  re-ship. Against every cross-chain product a judge has seen, this is the differentiator.
- **The register preloading is exactly right.** `AQUA.safeBalances(...)` runs before `runLoop`, which
  is why stock `AquaOpcodes` correctly omits `StaticBalances`/`DynamicBalances`. That is a subtle,
  correct design decision and the omission is the documentation.
- **`ctx.runLoop()` as the wrapper mechanism** makes instruction composition genuinely compositional —
  our band wraps our spread wraps the curve, and the nesting order carries real meaning.
- **`Shipped` emitting the full strategy blob "for data availability"** is what makes a cross-chain
  position verifiable from chain data alone. Our `positionId` lives inside the program bytes, so
  anyone can prove two legs are one position with no messaging layer, no attestation and no registry.
  That single design choice is doing a lot of work for us.

---

# The Graph

Versions: `graph-cli` 0.98, Subgraph Studio, matchstick, AssemblyScript 0.19.23, the decentralised
gateway for mainnet reads. Eight subgraphs deployed across three Studio accounts.

## 2.1 The deploy key and the query key are different, and `graph auth` accepts either without complaint

A Studio **deploy** key (one per account) and a Gateway **query** key are different credentials.
`graph auth <key>` accepts either and reports success. The mismatch surfaces only at deploy time, as:

```
Deploy key not found.
```

which reads as "your account has no key" rather than "you authed with the wrong kind of key".

**Fix:** validate the key's shape at `graph auth` time and name which kind was supplied.

## 2.2 The documented Studio deploy endpoints 404, and the CLI's own defaults work

```
graph deploy --node https://api.studio.thegraph.com/deploy/ \
             --ipfs https://api.studio.thegraph.com/ipfs/
```

fails with a plain nginx **404** from the IPFS upload. The message names IPFS, so it reads like a
broken file or a bad build. graph-cli 0.98 already defaults to the right endpoints — the fix is to
pass **neither flag**.

Those URLs are still in circulation in older docs and in generated `package.json` scripts (including
ones we inherited). Non-interactive deploys also need `--version-label`, which is not obvious until a
CI run hangs on a prompt.

## 2.3 The rate limit is per *version label*, and the refusal is HTML

Studio meters roughly **3,000 queries per three hours per deployment endpoint** — not per account.
Three things followed from that:

- **The refusal body is `text/html`.** A client that parses JSON before checking the status reports
  `SyntaxError: Unexpected identifier "Too"`, which reads as a bug in the caller. Check
  `response.status` first.
- **Backoff is useless** against a three-hour window. `x-ratelimit-reset` is the only correct signal
  and it is not mentioned anywhere we could find.
- **The windows drift apart per endpoint.** During one outage our Sepolia fills endpoint reset at
  19:03Z while Base's and Arbitrum's reset at 21:52Z. "The quota is exhausted" is rarely true of
  everything at once, which is genuinely useful to know mid-demo.

**The good half of this**, and we want to be clear it is good: because metering is per label and *old
labels keep indexing*, deploying a fresh version label is an instant, free emergency lever with a new
counter. We used it twice. Please keep that behaviour — but document it, because right now it reads
like an accident.

## 2.4 A version label that was never deployed answers HTTP 200 with `{"message":"Not found"}`

No `errors` key. No `data` key. Not a transport error and not a GraphQL error.

Any rotation script that checks the status code alone will happily repoint every reader at a dead URL
and report success. Ours had to decide on the body instead. An *exhausted* label is different again: a
plain-text 429 that is not JSON at all. So a health check has to handle three non-JSON shapes from one
endpoint.

**Fix:** 404 for a label that does not exist.

## 2.5 Querying past the indexer head is a hard error, not an empty result

```
has only indexed up to block number N
```

This matters for anything doing block-pinned reads, which is anything trying to be deterministic. Our
reference pull targets `now − buffer` and must clamp to `min(target, _meta.block)` — without the clamp,
any moment the indexer falls behind the buffer fails the entire read rather than degrading.

It is the right behaviour. It just needs to be on the `_meta` documentation page, next to the thing
that tells you the head.

## 2.6 A nullable `Int` comes back as `0`, not `null`

Declared `Int`, left unset, read back as `0`. Nullable `BigInt` and `Boolean` round-trip null
correctly; `Int` does not.

For us the field was a reference sequence number and a tilt in basis points, where **zero is a
perfectly legal value** — so "no reference existed" and "the reference said zero" became
indistinguishable in the data. We now carry an explicit `hasReference` boolean beside it, which is the
same workaround we needed for `hasFee` elsewhere.

**Fix:** make nullable `Int` round-trip, or reject it at codegen with a message naming the alternative.

## 2.7 AssemblyScript 0.19 crashes comparing an overloaded `BigInt` to null

`assert.assertNull(someNullableBigInt)` kills `asc` 0.19.23 inside `compileBinaryOverload` with a bare
`AssertionError: assertion failed` and a stack trace pointing only at dist files. `BigInt` overloads
`==` and the overload cannot take a null operand.

The error names nothing in your code. Carrying an explicit boolean is the workaround, and it applies to
any `graph-ts` type with operator overloads.

## 2.8 A throwing handler halts the entire sync

There is no partial-failure mode: one unhandled revert in one handler stops indexing for the whole
subgraph. This is the highest-impact rule we learned, and it drove our whole decoder design — every
decode path is defensive, `UNDECODABLE` beats anything that can revert, and it is always `try_`, never
the plain contract call. `safeBalances` in particular reverts for a token not in an active strategy,
which would have halted a sync from a handler.

**Fix:** it is a defensible design, but it belongs in bold at the top of the mappings guide, not
discovered.

## 2.9 Matchstick has no Ubuntu 26 binary, and the Docker fallback needs two undocumented fixes

`graph test` maps the OS major version to a release asset and accepts only Linux 22 or 24, so on
Ubuntu 26 it fails with `Unsupported platform: Linux x64 26`. The `binary-linux-22` asset does not run
directly either — it wants `libpq.so.5`.

`graph test -d` builds an Ubuntu 22 image, and then:

- the container run fails with `cannot attach stdin to a TTY-enabled container` when stdin is not a
  terminal (i.e. in CI). Running the built image directly works:
  `docker run --rm --mount type=bind,source="$(pwd)",target=/matchstick matchstick`.
- matchstick shells out to `node_modules/assemblyscript/bin/asc`, which pnpm does not hoist, so the
  compile step fails with `No such file`. `assemblyscript` has to be an explicit devDependency.
- matchstick reads `./subgraph.yaml` unless `matchstick.yaml` sets `manifestPath`.

Net effect: on a current Linux distro without Docker, the test suite **cannot be run at all**. That is
where we ended up, and it is why our subgraph tests were verified before the environment changed rather
than on the day.

## 2.10 The testnet subgraphs on the gateway exist but are unservable

Uniswap v3 deployments are published at the right IDs for Base Sepolia and Arbitrum Sepolia, and both
answer:

```
subgraph not found
subgraph not found: no allocations
```

Verified with our own gateway key in the same request batch that successfully queried a mainnet
subgraph, so it is not a key or config problem — nobody is allocated to serve them.

This was the single biggest design risk in our project (our whole cross-chain price angle assumed a
shared schema live on both chains) and we had to self-deploy our own subgraphs instead. That turned out
fine, and honestly better. But **a published deployment that cannot be queried should say so**, in the
explorer and in the error. "No allocations" is the right words in the wrong place — it belongs on the
subgraph's page, before anyone builds against it.

## 2.11 Three subgraphs per Studio account

We are at eight subgraphs and therefore three accounts, with keys and quotas per account, and a README
that must name the right endpoint for each claim. For a project indexing several chains this is
reached immediately. Worth raising the limit or making it per-organisation.

## What works well

- **`_meta { block { number hash } hasIndexingErrors }` is the best honesty primitive in any of the
  three stacks.** We carry it through every response and expose it in the UI. It costs nothing and it
  is what lets a data product tell the truth about itself.
- **AssemblyScript mappings can bind and call view functions**, which makes reconstructing state that
  is not in the event stream possible. We ended up not needing it — push and pull events alone
  reconstruct every position's balances — but having the escape hatch is what let us prove that.
- **Studio's sync feedback is good**: a fresh label indexed a testnet chain to head in five to ten
  minutes, with visible progress and honest indexing-error reporting.
- **The decentralised gateway for mainnet reads was flawless.** Our confidential workflow reads a
  volatility series from the Uniswap v3 mainnet subgraph through the gateway on every hourly run, and
  it has not failed once.
- **The standardized-schema framing is the right ask.** Building one entity shape across an entire
  venue — every maker, every app — produced a dataset nobody had, and it exists because the track asked
  for a standard rather than a dashboard.

---

# Chainlink — CRE Confidential Workflows

Versions: `cre` CLI **v1.32.0** (latest, confirmed by `cre update`), `@chainlink/cre-sdk` **1.20.0**
(latest, published 2026-09-08), template `hello-confidential-workflows-ts`, bun 1.4.2, Linux x64. Both
bugs below were **re-verified on 1.20.0 / 1.32.0** after first being found on 1.18.0; neither is fixed.

## 3.1 Any `preHook` makes a workflow fail with a config-parsing error

**Severity: high.** It makes the documented capability-restriction feature unusable, and the error
points at entirely the wrong place.

```
✗ workflow execution failed: Failed to parse configuration: Unexpected end of JSON input
```

The configuration is fine. Removing the hook — changing nothing else — makes the same workflow run.
Minimal reproduction on the stock scaffold:

```ts
cre.handler(
  cronTrigger.trigger({ schedule: config.schedule }),
  () => 'probe',
  { preHook: () => ({}) },   // remove this line and the workflow runs
)
```

An **empty** hook returning `{}` is enough. Also tried, all failing identically: a fully-populated
`RestrictionsJson` built from `cre.restrictors.EVMRestrictor`'s own helpers; with and without
`maxTotalCalls`; `CAPABILITY_RESTRICTION_TYPE_CLOSED` and `_OPEN`; on the TEE and non-TEE handler; and
with `--limits none`.

**Root cause, from the compiled SDK.** `RunnerBase.newRunnerHelper` calls `configHandler(request, ...)`
*before* it dispatches on `request.request.case`:

```js
static async newRunnerHelper(newRunner, configHandlerParams) {
  hostBindings.versionV2()
  const request = RunnerBase.getRequest()
  const config = await configHandler(request, configHandlerParams)   // every phase, including preHook
  return newRunner(config, request)
}
```

`configHandler`'s default parser is `JSON.parse(Buffer.from(request.config).toString())`, and the host
sends the `preHook` `ExecuteRequest` with an **empty `config` field** — so this is `JSON.parse('')`.
Either side can fix it: the host can populate `config` on preHook requests, or the SDK can skip config
parsing for that phase. `sdk/utils/config/index.js` and `sdk/wasm/runner.js` are byte-identical between
1.18.0 and 1.20.0, so nothing has moved.

**The message cost more than the bug.** "Failed to parse configuration" reads as *your config file is
malformed*. We spent over an hour bisecting a valid config — deleting fields, shortening values,
measuring byte sizes — and briefly convinced ourselves there was a config-size cliff, because configs
that fail zod validation early never reach the hook and therefore appeared to work. Any error raised at
hook-evaluation time, naming the hook, would have cost minutes.

**Impact on us:** our pre-execution capability budget is written and unit-tested for both workflows but
**cannot be wired in**, so it ships as an exported function with a comment. In production both
workflows would run with no capability restriction at all. That is precisely the control a confidential
workflow most wants, since it bounds what a compromised handler can do.

## 3.2 `TestTeeRuntime` exists but is unreachable, and its own docs name a factory that does not exist

**This corrects our first draft of this report**, which repeated the stock template's claim that no TEE
test runtime ships. It does:

- `TestTeeRuntime<T> extends TeeRuntimeImpl<T>` is present in `dist/sdk/testutils/test-runtime`, in
  **1.18.0 and 1.20.0** alike, with `getLogs()` and `setTimeProvider()` — everything a determinism test
  wants.
- It is **not exported from `@chainlink/cre-sdk/test`**, which is the only test entrypoint in the
  package's `exports` map. 1.20.0 exports it from `testutils/index.d.ts`, but `./testutils` is not an
  export path either.
- Its doc comment says *"construct via `newTestTEERuntime`"*. **No such function exists anywhere in the
  package** — that identifier appears only inside the comment. The constructor it does have takes
  `RuntimeHelpers`, `TestWriter` and `TestRuntimeState`, none of them publicly exported.

So the class is written, documented, and impossible to use. **We opened [PR #316](https://github.com/smartcontractkit/cre-sdk-typescript/pull/316)** to fix it: it adds
`newTestTEERuntime` mirroring `newTestRuntime`, exports both from the public test surface, and extracts
the shared registry/writer/state setup so the two factories cannot drift. 68 lines added, four tests,
`bun test` / `biome ci` / `typecheck` clean.

The lesson we took from getting this wrong the first time is worth passing on: **template comments are
not API documentation.** `dist/` is.

## 3.3 CRE test doubles have to speak protobuf, not the documented JSON

Every confidential workflow currently hand-rolls a fake runtime (see 3.2), and getting it right meant
reading compiled SDK internals:

- `.result()` returns the protobuf **message**, not its JSON form, so `BigInt.absVal` is a `Uint8Array`.
  Passing the base64 string that the JSON type documents throws
  `SyntaxError: Failed to parse String to BigInt` from inside `bytesToBigint`.
- `evmClient.writeReport` calls `report.x_generatedCodeOnly_unwrap()`, so a `Report` double must carry
  that underscore-prefixed generated-code-only method or the call throws.

Both are discoverable only by reading `dist/`. Worth noting the contrast: `@chainlink/cre-sdk/test`
*does* publicly export `addContractMock` and `getTestCapabilityHandler`, which are exactly the right
shape — the TEE runtime just did not make it through the same door.

## 3.4 `cre workflow simulate` needs three flags, and none of the errors names the right one

In order, all with unhelpful messages:

- `--target staging` → `target not found: staging`. The target is the **YAML key**, `staging-settings`.
- Without `-T`, it tries to prompt and dies with `could not open a new TTY` under anything non-interactive.
- With `--non-interactive` it then demands `--trigger-index 0`.

Working invocation, for the docs:

```
cre workflow simulate ./fast -T staging-settings -e <envfile> --non-interactive --trigger-index 0
```

Related: `--config` resolves relative to the **workflow folder**, but the error prints the path as
given (`ConfigPath must be a valid existing file: ./fast/config.staging.json`), so it reads as a
missing file rather than a different base directory.

## 3.5 `--broadcast` goes to a mock forwarder, and a rejected report still prints a green result

`cre workflow simulate --broadcast` does not call the receiver directly. It submits each report to a
`MockKeystoneForwarder` that the simulator knows per chain, and that contract calls `onReport`.

If the receiver's configured forwarder is anything else, the call is rejected **inside the forwarder**,
which emits `ReportProcessed(success = false)` — and the simulator prints a successful result anyway.
Our registries trusted the deployer EOA initially, so every report we broadcast for a day was silently
rejected while the tooling reported success.

**Fix:** surface the forwarder's `success` flag in the simulator's output. The information is already
on chain in the same transaction.

**Fix (docs):** state that `--broadcast` routes through a per-chain mock forwarder, and publish those
addresses. We had to find ours by scanning blocks.

## 3.6 The CLI rewrites its own session file on every run, so it cannot be a read-only secret

`cre workflow simulate` requires a login session — with no `~/.cre` it exits 1 with "run cre login" —
and the CLI **rewrites `~/.cre/cre.yaml` on every run** as it refreshes a 15-minute access token.

For a scheduled deployment that means the session cannot be mounted as a read-only secret; it needs
writable persistent storage. We ended up mounting it from a GCS bucket, read-write, seeded from a dev
machine. That is a surprising amount of infrastructure for "run this on a timer", and the requirement is
not documented anywhere.

Also: **concurrent `cre` runs fail.** Two timers firing together both died within 40 seconds with no
result and no useful error. Anything scheduling more than one workflow needs a lock.

## 3.7 `cre init` requires login to scaffold a public template, and writes to the wrong directory

`cre templates list` works unauthenticated; `cre init` fails with "Authentication required". The
templates come from public GitHub repositories, so this looks unintentional, and it blocks first-run in
any non-interactive environment.

Separately, `cre init` inside an existing project writes a **new directory named after
`--project-name`** rather than into `--project-root`, so adopting CRE in an existing repo layout means
moving files by hand.

## 3.8 The HTTP request body is base64, and the runtime has no encoder

`RequestJson.body` is declared `bytes` in protobuf, whose JSON form is base64 — so passing a raw JSON
string sends garbage. The workflow runtime is neither a browser nor Node: there is no `btoa`, no
`Buffer`, and the SDK exports no helper. We hand-rolled a `toBase64` and round-trip tested it against a
known-good decoder, because padding and multi-byte input are exactly what such an encoder gets wrong.

**Fix:** export a `toBase64` from the SDK. Every workflow that POSTs anything needs one, and everyone
will write it slightly differently.

## 3.9 The default template schedule makes every debug cycle take a minute

The stock `0 */1 * * * *` makes every simulation wait up to 60 seconds before anything happens.
`*/10 * * * * *` turns a debugging loop from minutes into seconds. Worth being the template default for
staging, or a line in the README.

## 3.10 The testnet feed directory made us conclude a feed did not exist when it does

Recording this as a correction rather than a bug, because we got it wrong first.

Reading `reference-data-directory` for Arbitrum Sepolia, we found only
`ETH/USD-Streams-TWAP-…-testnet-production` entries and concluded no standard `AggregatorV3` ETH/USD
Data Feed existed there. It does. All three of our testnets carry live, **contract-readable** ETH/USD
feeds, verified later by calling `latestRoundData` over the public RPCs — Sepolia
`0x694AA1769357215DE4FAC081bf1f309aDC325306` at $2465.98, Base Sepolia `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1`
at $2465.88, Arbitrum Sepolia `0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165` at $2466.12, all within 20 bps
of the market.

The mistake was ours. What made it easy: on a testnet page, Data Streams TWAP entries and Data Feeds
carry very similar human names, sit in the same JSON, and the feed type is not the first thing you
read. A `feedType` badge at the top of each entry, or separate files, would have prevented it.

We wrote the wrong conclusion into two deployment records, and it stayed there for five days shaping
decisions downstream. **Re-read the chain before trusting a note about the chain** is the rule we now
work by, and it came from this.

## 3.11 Smaller things

- **Env var names that begin with a digit** work through `cre -e` but cannot be `source`d from a shell.
  Ours is `1INCH_API_KEY`; `. .env` fails with "command not found". Not a CRE bug — but `cre -e` being
  *more permissive than the shell* is a sharp edge worth a note in the secrets docs.
- **Secret ids and env var names must differ.** The CLI warns when they match, so `GRAPH_API_KEY` maps
  to `CRE_GRAPH_API_KEY`. Sensible, and easy to trip over at first run since the failure is at secret
  resolution rather than at config load.
- **One shared `secrets.yaml` across workflows** means simulating either workflow needs every secret
  both declare. A missing value takes a workflow down rather than degrading it.

## What works well

- **`cre workflow simulate` genuinely runs a confidential workflow with no deploy access.** That single
  fact is what made this integration buildable in a hackathon window, and it is **not obvious from the
  docs** — the private-beta banner reads as though nothing works without enrolment. Chainlink Labs
  confirmed it in Discord and it was the most valuable sentence anyone told us all week. Put it on the
  Confidential Workflows landing page.
- **`LAST_FINALIZED_BLOCK_NUMBER` plus `blockNumber(n)` is the right primitive for determinism.**
  Resolving the finalized block once and naming that number in every later read is a clean,
  discoverable way to make a multi-chain read reproducible, and `protoBigIntToBigint` /
  `bigintToProtoBigInt` make it painless. Our whole determinism story rests on it.
- **The simulator's own banner is the most honest sentence in the toolchain:** *"The simulator is not a
  real TEE, and is meant to debug. Do not use it for sensitive information."* We adopted its framing
  verbatim for our own disclosure, and it is the reason our README can be straightforward about what is
  enforced and what is modelled. More tools should talk like this.
- **The `ReceiverTemplate` / `IReceiver` shape is well judged**, particularly the doc comment stating
  that a revert means "transient failure, retry". That one sentence is what told us our rejection paths
  had to emit-and-return rather than revert, since a stale sequence number can never clear on a retry.
  It is a subtle contract and the docs get it right.
- **The optional workflow identity pins** (`expectedWorkflowId`, `expectedAuthor`,
  `expectedWorkflowName`) are exactly the right granularity — "the DON signed this" versus "the DON
  signed *this workflow*" matters when one forwarder serves every workflow on a chain.

---

## Cross-cutting: the one thing all three could do

Each of these stacks has a **repository version** and a **deployed version**, and in all three cases we
were bitten by assuming they were the same thing:

- 1inch: the pinned submodule's opcode table is not the deployed router's table (§1.2).
- The Graph: a published subgraph deployment is not necessarily a servable one (§2.10).
- Chainlink: `restrictions()` type-checks against the SDK and cannot be wired into the runtime (§3.1).

In every case the code compiled, the tooling reported success, and the answer was wrong. A version
table — *this release, this deployment, these addresses, verified on this date* — would have cost each
team an afternoon and saved us three.
