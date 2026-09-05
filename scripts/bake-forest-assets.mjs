/** Offline-only conversion of the CC0 source atlas; provenance in forest CREDITS. */
import sharp from 'sharp';
await sharp(new URL('./data/textures/pine-atlas-source.png', import.meta.url).pathname)
  .resize({width:1024}).webp({quality:85,alphaQuality:100})
  .toFile(new URL('../public/game/textures/pine-atlas.webp',import.meta.url).pathname);
