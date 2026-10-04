/**
 * Deterministic 5×5 mirrored identicon for a wallet address.
 * @remarks No external service; output is static SVG markup safe for
 *   x-html because the only inputs are validated hex digits.
 */

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function identiconSvg(address: string, size = 28): string {
  if (!ADDRESS.test(address)) return "";
  const hex = address.slice(2).toLowerCase();
  const hue = parseInt(hex.slice(0, 3), 16) % 360;
  const fill = `hsl(${hue} 55% 55%)`;

  const rects: string[] = [];
  // 3 source columns × 5 rows; column 0/1 mirror to 4/3, column 2 is the axis.
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      const nibble = parseInt(hex[3 + y * 3 + x], 16);
      if (nibble % 2 !== 0) continue;
      rects.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
      if (x < 2) rects.push(`<rect x="${4 - x}" y="${y}" width="1" height="1"/>`);
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5" width="${size}" height="${size}" ` +
    `fill="${fill}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">` +
    rects.join("") +
    `</svg>`
  );
}
