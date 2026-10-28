# Art module: requests for other owners

Done by the integrator in round 1 (thanks): dialogue portraits wired, poodle_left/right used
when banking, @types/node for verify. Open requests:

## 1. src/interaction/index.ts: hairball wobble frames + threat ring (owner: interaction)
`hairball` now has 2 frames (fuzzy tufts wobble). In the spit render (~line 432):
`drawSprite(ctx, yarn ? 'yarn' : 'hairball', s.x, s.y, { frame: (s.t >> 3) & 1 });`
The violet contrast ring (`pxRing(..., 't')`) makes hairballs read like a power-up gem again;
please use a warm threat colour for hairballs, e.g. `((s.t >> 2) & 1) ? '6' : 'r'`, and keep 'c'
for yarn.

## 2. Boss shadow detached (owner: interaction, Boss.render)
In play the boss shadow is a flat 1px line ~40px below the 64px sprite, so the boss looks
detached. Draw the shadow as a dithered oval (about 40x8 px, palette 'v' or '1') whose top edge
sits 4-6px below the sprite's bottom edge (sprite centre y + 28..30), like the 32px cats.

## 3. Anti-aliased rings next to crisp sprites (owners: effects, interaction, ui)
`ctx.arc` / strokes blur next to the pixel art: shield bubble + hit rings (effects/index.ts ~51),
interaction glow (~287), ui/touch.ts:40-41. Please switch to the shared pixel helpers
(pxRing / pxDisc / pxDither) that already exist in core.

## 4. Showcase variety (owner: showcase / interaction)
The interaction showcase wave 3 is 24 identical tabbies, so the breed silhouettes never show.
Please mix breeds there (tabby, tuxedo, siamese, persian, sphynx, mainecoon, calico,
russianblue, bengal, scottishfold).

## 5. src/ui/index.ts title/ending (owner: ui), optional
Title and ending could show `portrait_pom` scaled 2x instead of the top-down flight sprite.

## 6. Dusk HUD icon + moon-area night tint (owner: ui / world), seen by the art critic
The LOCAL TIME panel shows the moon icon for dusk as well as night; dusk wants its own icon
(e.g. a half-set sun). On the moon area the night tint barely shows. Not art-module work.

## 7. Round 3 note (no action needed)
portrait_<breed> are now their own 40x40 busts (3/4 head turn + expression), not boss crops;
names unchanged, so content/dialogue.json keeps working. Hairball now carries its own light-tan
highlight, so the draw-time ring in interaction can be subtler (request 1 still stands).
