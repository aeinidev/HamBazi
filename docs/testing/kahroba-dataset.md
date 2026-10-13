# Kahroba economic dataset verification

Date: 2026-10-12. Scope: isolated K1 numerical data. Status: **verified for K1; no invented or substituted cards**.

## Accepted source and reuse

The accepted numerical source is [AchrafAmil/splendor-api](https://github.com/AchrafAmil/splendor-api/tree/248579fd4099a6f0a519554228a32b5ec6287de9), pinned to commit `248579fd4099a6f0a519554228a32b5ec6287de9`. Its repository [MIT license](https://github.com/AchrafAmil/splendor-api/blob/248579fd4099a6f0a519554228a32b5ec6287de9/LICENSE) covers the source resources; no resource-specific exclusion was found. The complete copyright/permission notice is retained in `packages/games/kahroba-engine/LICENSES/splendor-api-MIT.txt` and included in package files.

Only numerical resources are adapted. The module's algorithms are original. No upstream Kotlin logic, publisher art/logos/character names, GPL code/CSV/photographs or verbatim rulebook text is distributed. The license grants reuse of this source; it does not establish publisher endorsement or settle the separate public-release naming/artwork gate. The U.S. Copyright Office [distinguishes game procedures from protected explanatory text/art](https://www.copyright.gov/register/tx-games.html); this record is not a claim of legal clearance for every jurisdiction or a release approval.

| Source resource                       | SHA-256                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| `src/main/resources/cards/cards.txt`  | `a067b515826f5baa417ed92ec8076794baf6959f5409ba062932636b9f2cdfad` |
| `src/main/resources/cards/nobles.txt` | `dd4110ab7173b052af9a58cdfbeea5746ace3af8af49bbc2eae0edbb0cefa1a1` |
| `LICENSE`                             | `01aee0789f5e74feb3b600669ff1860614f388a81533571768b0193e38bae975` |

The raw source's card columns are ID, white, blue, green, red, black, zero-based tier, bonus, prestige. Noble columns are ID, prestige, then the same five requirements. The upstream noble loader does not interpret its own file in this order; that loader is not used. Source IDs become Kahroba-owned opaque definition IDs. Color conversion is white→diamond, blue→sapphire, green→emerald, red→ruby, black→onyx. No numerical economic change is made.

## Development-card verification

The [physical-card photographic transcription](https://github.com/anicolao/splendor/tree/5b3efd26f2e460b1bef3839a058270b536a13648) at commit `5b3efd26f2e460b1bef3839a058270b536a13648` provides two original photographs containing 45 cards each and `data/verified_card_properties.csv`. Its documented checks include image/number recognition and inventory checks. That independent project is GPL-3.0; it is an inspection reference, not a distributed code/data source.

Both complete photographs were inspected. A normalized multiset comparison includes tier, bonus, prestige and all five costs: **90 matches, zero unmatched tuples on either side**. It is not merely a count/symmetry check. A source-ID↔photographic-ID crosswalk, photographs and CSV hashes are recorded in the machine-readable [provenance](../../packages/games/kahroba-engine/dataset-provenance.json). The two photographs/CSV remain outside the repository; no GPL artifact is packaged.

The catalogue contains 40/30/20 cards, respectively 8/6/4 per bonus category. The disputed tier-one diamond card with costs diamond 3, sapphire 1, onyx 1 matches the photographed physical card and the accepted MIT resource. It is covered explicitly by the catalogue test.

## Noble verification

All ten raw definitions were compared with the ten readable [tile scan references](https://github.com/roeey777/Splendor-AI/tree/95f84d2e6e839c0ef09ca97bdc3b3048a792fb0b/src/splendor/splendor/resources/nobles_large) at commit `95f84d2e6e839c0ef09ca97bdc3b3048a792fb0b`. Requirements and point badges were visually inspected. Publisher-maintained [Dized noble rules](https://rules.dized.com/game/vdDSzuu4RsC8F45PsW0TKw/8HWwgyLFQV-4Th75hzhBCg/the-noble-tiles) independently confirm three prestige per tile. These references reproduce physical published components; they are not claimed to be a publisher-provided numerical export. Scans are used for inspection only and are not shipped.

Requirements in diamond/sapphire/emerald/ruby/onyx order:

| Kahroba ID         | Requirements      | Prestige |
| ------------------ | ----------------- | -------- |
| `kahroba-noble-00` | 3 / 3 / 3 / 0 / 0 | 3        |
| `kahroba-noble-01` | 0 / 3 / 3 / 3 / 0 | 3        |
| `kahroba-noble-02` | 3 / 0 / 0 / 3 / 3 | 3        |
| `kahroba-noble-03` | 0 / 0 / 3 / 3 / 3 | 3        |
| `kahroba-noble-04` | 3 / 3 / 0 / 0 / 3 | 3        |
| `kahroba-noble-05` | 4 / 0 / 0 / 0 / 4 | 3        |
| `kahroba-noble-06` | 4 / 4 / 0 / 0 / 0 | 3        |
| `kahroba-noble-07` | 0 / 0 / 4 / 4 / 0 | 3        |
| `kahroba-noble-08` | 0 / 0 / 0 / 4 / 4 | 3        |
| `kahroba-noble-09` | 0 / 4 / 4 / 0 / 0 | 3        |

## Rejected or insufficient references

- `boardgamers/splendor` claims agreement with older CSVs, but inspected numerical tuples disagree. It also has no repository license. Neither its data nor logic is used.
- Older `bouk/splendimax` and `seal256/splendor` inventories were investigated, but have no repository license and do not provide sufficient authority by agreement alone. They are not source material for this package.
- The publisher's noble-history PDF was rendered and inspected. It contains biographies and base/expansion labels, not a complete economic requirements table; it is not numerical verification.
- The supplied Kahroba gameplay image and archive are artwork references, not economic datasets.

## Reproducible local gate

The accepted raw MIT resources are retained as test fixtures. `catalog.test.ts` checks their pinned hashes and every exported numerical value. The independently compared normalized tuple digest is `99f42d76b89ee2d668a46acf153b9aecb9dc823e2dd7decc7c3adf8f4dfd31c2` for `{cards,nobles}` in the documented source-ID/column order. Test runs never regenerate expected resources, fetch the network or replace goldens. Any later correction must repeat provenance verification and receive new economic/ruleset pins.
