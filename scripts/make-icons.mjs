// Renders the maskable PWA icons (192 and 512 px) from public/icon.svg using the Chromium that
// Playwright already installs (devDependency; run `npx playwright install chromium` once).
// The artwork sits inside the central 80% safe circle (scaled to 0.66 around the centre) on a full-bleed
// background, so launchers that mask the icon to a circle or squircle do not clip it.
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const SVG_SOURCE = 'public/icon.svg';
const SIZES = [192, 512];
const BACKGROUND = '#12141a';
const SCALE = 0.66;
const OFFSET = (512 * (1 - SCALE)) / 2;

const source = readFileSync(SVG_SOURCE, 'utf8');
// Keep the art, drop the rounded background rect (maskable icons must be full bleed).
const art = source
  .replace(/<svg[^>]*>/, '')
  .replace('</svg>', '')
  .replace(/<rect[^>]*\/>/, '');
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BACKGROUND}"/>
  <g transform="translate(${OFFSET} ${OFFSET}) scale(${SCALE})">${art}</g>
</svg>`;

const browser = await chromium.launch();
try {
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(maskable).toString('base64')}`;
    await page.setContent(`<html><body style="margin:0"><img src="${dataUrl}" width="${size}" height="${size}" style="display:block"></body></html>`);
    await page.waitForFunction(() => {
      const img = document.querySelector('img');
      return img !== null && img.complete && img.naturalWidth > 0;
    });
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size }, type: 'png' });
    writeFileSync(`public/icon-maskable-${size}.png`, png);
    console.log(`wrote public/icon-maskable-${size}.png (${png.length} bytes)`);
    await page.close();
  }
} finally {
  await browser.close();
}
