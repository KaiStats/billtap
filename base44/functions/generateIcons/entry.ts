import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Pure JS PNG encoder + icon generator — no native deps

function createIconPixels(size) {
  const pixels = new Uint8Array(size * size * 4);

  // Background: #0a0a0a
  for (let i = 0; i < size * size; i++) {
    pixels[i * 4] = 10; pixels[i * 4 + 1] = 10; pixels[i * 4 + 2] = 10; pixels[i * 4 + 3] = 255;
  }

  // Brand violet rounded rect: #7c3aed
  const rectSize = Math.floor(size * 0.62);
  const rectX = Math.floor((size - rectSize) / 2);
  const rectY = Math.floor((size - rectSize) / 2);
  const radius = Math.floor(rectSize * 0.22);

  for (let y = rectY; y < rectY + rectSize; y++) {
    for (let x = rectX; x < rectX + rectSize; x++) {
      const dx = Math.max(rectX + radius - x, 0, x - (rectX + rectSize - radius - 1));
      const dy = Math.max(rectY + radius - y, 0, y - (rectY + rectSize - radius - 1));
      if (dx * dx + dy * dy <= radius * radius) {
        const idx = (y * size + x) * 4;
        pixels[idx] = 124; pixels[idx + 1] = 58; pixels[idx + 2] = 237; pixels[idx + 3] = 255;
      }
    }
  }

  // Bitmap font for "BT"
  const B = [[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0]];
  const T = [[1,1,1,1,1],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0]];
  const lW = 5, lH = 7, gap = 1;
  const scale = Math.max(1, Math.floor(rectSize * 0.20 / lH));
  const totalW = (lW * 2 + gap) * scale;
  const totalH = lH * scale;
  const tx = Math.floor(rectX + (rectSize - totalW) / 2);
  const ty = Math.floor(rectY + (rectSize - totalH) / 2);

  [[B, tx], [T, tx + (lW + gap) * scale]].forEach(([bitmap, ox]) => {
    for (let row = 0; row < lH; row++) {
      for (let col = 0; col < lW; col++) {
        if (bitmap[row][col]) {
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const px = ox + col * scale + sx, py = ty + row * scale + sy;
              if (px >= 0 && px < size && py >= 0 && py < size) {
                const idx = (py * size + px) * 4;
                pixels[idx] = 255; pixels[idx + 1] = 255; pixels[idx + 2] = 255; pixels[idx + 3] = 255;
              }
            }
          }
        }
      }
    }
  });

  return pixels;
}

function encodePNG(size, pixels) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  const crc32 = (data, off, len) => {
    let c = 0xFFFFFFFF;
    for (let i = off; i < off + len; i++) c = table[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  const adler32 = (data) => {
    let s1 = 1, s2 = 0;
    for (const b of data) { s1 = (s1 + b) % 65521; s2 = (s2 + s1) % 65521; }
    return (s2 << 16) | s1;
  };

  const rawData = new Uint8Array(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rawData[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4, d = y * (size * 4 + 1) + 1 + x * 4;
      rawData[d] = pixels[s]; rawData[d+1] = pixels[s+1]; rawData[d+2] = pixels[s+2]; rawData[d+3] = pixels[s+3];
    }
  }

  const BLOCK = 65535;
  const numBlocks = Math.ceil(rawData.length / BLOCK);
  const deflated = new Uint8Array(2 + rawData.length + numBlocks * 5 + 4);
  let di = 0;
  deflated[di++] = 0x78; deflated[di++] = 0x01;
  let rem = rawData.length, off = 0;
  while (rem > 0) {
    const blen = Math.min(rem, BLOCK);
    deflated[di++] = rem <= BLOCK ? 1 : 0;
    deflated[di++] = blen & 0xFF; deflated[di++] = (blen >> 8) & 0xFF;
    deflated[di++] = (~blen) & 0xFF; deflated[di++] = ((~blen) >> 8) & 0xFF;
    deflated.set(rawData.subarray(off, off + blen), di);
    di += blen; off += blen; rem -= blen;
  }
  const chk = adler32(rawData);
  deflated[di++] = (chk >> 24) & 0xFF; deflated[di++] = (chk >> 16) & 0xFF;
  deflated[di++] = (chk >> 8) & 0xFF; deflated[di++] = chk & 0xFF;
  const zlib = deflated.subarray(0, di);

  const w32 = (a, o, v) => { a[o]=(v>>24)&0xFF; a[o+1]=(v>>16)&0xFF; a[o+2]=(v>>8)&0xFF; a[o+3]=v&0xFF; };
  const chunk = (type, data) => {
    const tb = new TextEncoder().encode(type);
    const c = new Uint8Array(4 + 4 + data.length + 4);
    w32(c, 0, data.length); c.set(tb, 4); c.set(data, 8);
    w32(c, 8 + data.length, crc32(c, 4, 4 + data.length));
    return c;
  };

  const ihdr = new Uint8Array(13);
  w32(ihdr, 0, size); w32(ihdr, 4, size);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const parts = [
    new Uint8Array([137,80,78,71,13,10,26,10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const url = new URL(req.url);
    const sizeParam = parseInt(url.searchParams.get('size') || '192');
    const size = [192, 512].includes(sizeParam) ? sizeParam : 192;

    const pixels = createIconPixels(size);
    const pngBytes = encodePNG(size, pixels);

    return new Response(pngBytes, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `attachment; filename="icon-${size}.png"`,
        'Content-Length': pngBytes.length.toString(),
        'X-Icon-Size-Pixels': size.toString(),
        'X-File-Bytes': pngBytes.length.toString(),
      },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});