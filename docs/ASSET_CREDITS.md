# Added shop photographs

The original files are bundled for the local demo. The sample product names and RP prices do not describe an offer by either photographer.

| Local file | Original source | Credit and license | Changes |
| --- | --- | --- | --- |
| `frontend/public/assets/shop/oatmeal.jpg` | [Oatmeal (1).jpg](https://commons.wikimedia.org/wiki/File:Oatmeal_(1).jpg) | Renee Comet / National Cancer Institute — public domain | None; original photograph displayed with CSS sizing |
| `frontend/public/assets/shop/almonds.jpg` | [Bowl of chopped almonds.jpg](https://commons.wikimedia.org/wiki/File:Bowl_of_chopped_almonds.jpg) | Douglas P Perkins — [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | None; original photograph displayed with CSS sizing |

Attribution and license links are also available inside the shop's “상품 이미지 출처” disclosure. The CC BY-SA license applies to the almond photograph; this document does not relicense the surrounding application.

Existing shop images and dinosaur assets come from the user-provided [REXRUN Figma file](https://www.figma.com/design/lCWaAEae4xccaADW0osrLx/REXRUN?node-id=5-2). Node mappings are documented in [PIXEL_ADVENTURE.md](PIXEL_ADVENTURE.md).

The added battle atlases use section 14 (`511:579`, T-Rex/Raptor idle and walk), section 15 (`535:574`, ranged villains) and section 16 (`542:574`, melee villains) from that same file. `frontend/scripts/prepare-battle-assets.py` trims transparent margins, cleans alpha and resamples the original PNG fills to the 160×120 render cells. The 26 accessory images under `frontend/public/assets/customize/` use the HEAD (`359:600`) and PET (`359:689`) fills from Shop / Customize (`336:505`); their prices follow the design. These additions are user-provided design assets, with no new external license asserted here.

Character Vault uses section 18, frame `566:574`. The six roster fills (`566:598/601/604/607/610/613`) are SHA-256 matches to existing `assets/battle/493-579/582/592/585/589/595.png`. Per the 2026-10-01 review, its hero uses section 09 `Dino Assets / Flipped Originals` (`276:694`): T-Rex `276:699`, Triceratops `276:702`, Raptor `276:712`, Stegosaurus `276:705`, Pteranodon `276:709`, and Brontosaurus `276:715`. All six original fills are SHA-256 matches to the existing `assets/battle/276-*.png` files and are displayed unchanged with centered CSS containment. Skin previews `assets/character/desert.png`, `snow.png`, and `volcano.png` are unchanged exports of the individual filtered image layers `569:580`, `569:583`, `569:586`. Whole-screen renders and temporary Figma URLs are not included in the application.

The current combat update additionally uses the user-provided Figma 10/19/20/21 assets. `prepare-motion-assets.py` packs 25 new PNG atlases: seven dinosaur motion sheets, twelve villain walk sheets and six projectile sheets. Exact image-node mappings, reused byte-identical sources and the two projectile export-edge trims are documented in [PIXEL_ADVENTURE.md](PIXEL_ADVENTURE.md#figma-motion-asset-update-2026-09-30). No generated replacement artwork or external stock art was added.
