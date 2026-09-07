import { compareSurface } from '../lib/game/testing/surface-comparison';
console.log(JSON.stringify(['skier', 'snowboarder'].flatMap(rider =>
  ['powder', 'packed', 'firm', 'ice', 'slush'].map(surface => compareSurface(
    surface as Parameters<typeof compareSurface>[0], rider as Parameters<typeof compareSurface>[1],
  ))), null, 2));
