// Private glyphs are painted as vectors, never delegated to the system font.
const keys = ["identity", "facebook", "instagram", "linkedin", "x", "rss", "substack", "medium", "youtube", "other"] as const;
export function galaxyIconGlyph(provider: string): string {
  const index = keys.indexOf(provider.toLowerCase() as typeof keys[number]);
  return String.fromCodePoint(0xe000 + (index < 0 ? keys.length - 1 : index));
}

export function isGalaxyIconGlyph(value: string): boolean {
  const code = value.codePointAt(0) ?? 0;
  return value.length === 1 && code >= 0xe000 && code < 0xe000 + keys.length;
}

export function drawGalaxyIcon(ctx: CanvasRenderingContext2D, glyph: string, x: number, y: number, size: number): void {
  const key = keys[glyph.codePointAt(0)! - 0xe000];
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (key === "facebook" || key === "x" || key === "linkedin") {
    ctx.beginPath();
    ctx.roundRect(1.25, 1.25, 21.5, 21.5, 4);
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.translate(4, 4);
    ctx.scale(2 / 3, 2 / 3);
  }
  if (key === "facebook") {
    ctx.fill(new Path2D("M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"));
  } else if (key === "x") {
    ctx.fill(new Path2D("M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"));
  } else if (key === "instagram") {
    ctx.beginPath(); ctx.roundRect(2, 2, 20, 20, 5); ctx.stroke();
    ctx.beginPath(); ctx.arc(12, 12, 4, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(17.5, 6.5, 1, 0, Math.PI * 2); ctx.fill();
  } else if (key === "linkedin") {
    ctx.fill(new Path2D("M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452z"));
  } else if (key === "rss") {
    ctx.stroke(new Path2D("M4 11a9 9 0 019 9 M4 4a16 16 0 0116 16"));
    ctx.beginPath(); ctx.arc(5, 19, 1.5, 0, Math.PI * 2); ctx.fill();
  } else if (key === "substack") {
    ctx.fill(new Path2D("M5 3h14v2.7H5V3zm0 4.8h14v2.7H5V7.8zm0 4.8h14V21l-7-3.9L5 21v-8.4z"));
  } else if (key === "medium") {
    ctx.beginPath(); ctx.ellipse(6, 12, 5, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(16, 12, 3, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(22, 12, 1, 7, 0, 0, Math.PI * 2); ctx.fill();
  } else if (key === "youtube") {
    ctx.beginPath(); ctx.roundRect(1, 4, 22, 16, 4); ctx.stroke();
    ctx.fill(new Path2D("M10 8l7 4-7 4z"));
  } else if (key === "identity") {
    ctx.beginPath(); ctx.arc(12, 7, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fill(new Path2D("M3 22v-3a9 9 0 0118 0v3z"));
  } else {
    ctx.beginPath(); ctx.arc(12, 12, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.stroke(new Path2D("M3 12h18M12 3a20 20 0 000 18M12 3a20 20 0 010 18"));
  }
  ctx.restore();
}

export function measureGalaxyLabel(ctx: CanvasRenderingContext2D, text: string, size: number): number {
  return Array.from(text).reduce((width, char) => width + (isGalaxyIconGlyph(char) ? size + 4 : ctx.measureText(char).width), 0);
}

export function drawGalaxyLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number): void {
  let left = x - measureGalaxyLabel(ctx, text, size) / 2;
  for (const char of Array.from(text)) {
    const icon = isGalaxyIconGlyph(char);
    const width = icon ? size + 4 : ctx.measureText(char).width;
    if (icon) drawGalaxyIcon(ctx, char, left + width / 2, y, size);
    else {
      ctx.strokeText(char, left + width / 2, y);
      ctx.fillText(char, left + width / 2, y);
    }
    left += width;
  }
}
