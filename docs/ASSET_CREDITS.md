# Added shop photographs

The original files are bundled for the local demo. The sample product names and RP prices do not describe an offer by either photographer.

| Local file | Original source | Credit and license | Changes |
| --- | --- | --- | --- |
| `frontend/public/assets/shop/oatmeal.jpg` | [Oatmeal (1).jpg](https://commons.wikimedia.org/wiki/File:Oatmeal_(1).jpg) | Renee Comet / National Cancer Institute — public domain | None; original photograph displayed with CSS sizing |
| `frontend/public/assets/shop/almonds.jpg` | [Bowl of chopped almonds.jpg](https://commons.wikimedia.org/wiki/File:Bowl_of_chopped_almonds.jpg) | Douglas P Perkins — [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | None; original photograph displayed with CSS sizing |

Attribution and license links are also available inside the shop's “상품 이미지 출처” disclosure. The CC BY-SA license applies to the almond photograph; this document does not relicense the surrounding application.

Existing shop images and dinosaur assets come from the user-provided [REXRUN Figma file](https://www.figma.com/design/lCWaAEae4xccaADW0osrLx/REXRUN?node-id=5-2). Node mappings are documented in [PIXEL_ADVENTURE.md](PIXEL_ADVENTURE.md).

The added battle atlases use section 14 (`511:579`, T-Rex/Raptor idle and walk), section 15 (`535:574`, ranged villains) and section 16 (`542:574`, melee villains) from that same file. `frontend/scripts/prepare-battle-assets.py` trims transparent margins, cleans alpha and resamples the original PNG fills to the 160×120 render cells. The 26 accessory images under `frontend/public/assets/customize/` use the HEAD (`359:600`) and PET (`359:689`) fills from Shop / Customize (`336:505`); their prices follow the design. These additions are user-provided design assets, with no new external license asserted here.
