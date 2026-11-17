// SALTLINE's hand-in program for make.fun's best-game-01 (Node 22, standard
// library only). The game itself is the static site under game/ — a three.js
// tactical FPS that runs fully offline in a desktop browser. This program
// simply carries it to the grader: it copies game/ and screenshots/ into the
// output directory and writes dossier.json there with the kit's vendored
// library, capped exactly as the best-game gate expects.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// In the grader's container the output directory is /output; anywhere else,
// MAKEFUN_OUTPUT_DIR names it. Serve the game locally with `node serve.ts`,
// then open http://localhost:8080.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outDir, { recursive: true });
cpSync(join(root, 'game'), join(outDir, 'game'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
if (existsSync(join(root, 'screenshots'))) {
  cpSync(join(root, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
}

const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
console.log(`saltline: wrote game/, screenshots/ and dossier.json (${dossier.length} bytes) to ${outDir}`);
