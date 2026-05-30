#!/usr/bin/env node
/**
 * Génère build/icon.ico, build/icon.icns et build/icons/*.png depuis build/icon-source.png.
 * Usage : node scripts/generate-app-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import png2icons from 'png2icons';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const buildDir = path.join(root, 'build');
const sourcePath = path.join(buildDir, 'icon-source.png');
const iconsDir = path.join(buildDir, 'icons');
const linuxSizes = [16, 32, 48, 64, 128, 256, 512];

if (!fs.existsSync(sourcePath)) {
  console.error(`Image source introuvable : ${sourcePath}`);
  process.exit(1);
}

const input = fs.readFileSync(sourcePath);

const ico = png2icons.createICO(input, png2icons.BILINEAR, 0, false);
if (!ico) {
  console.error('Échec de la génération icon.ico');
  process.exit(1);
}
fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico);

const icns = png2icons.createICNS(input, png2icons.BILINEAR, 0);
if (!icns) {
  console.error('Échec de la génération icon.icns');
  process.exit(1);
}
fs.writeFileSync(path.join(buildDir, 'icon.icns'), icns);

fs.mkdirSync(iconsDir, { recursive: true });
await sharp(sourcePath)
  .resize(512, 512)
  .png()
  .toFile(path.join(buildDir, 'icon.png'));

for (const size of linuxSizes) {
  await sharp(sourcePath)
    .resize(size, size)
    .png()
    .toFile(path.join(iconsDir, `${size}x${size}.png`));
}

console.log('Icônes générées dans build/ (icon.ico, icon.icns, icon.png, icons/*)');
