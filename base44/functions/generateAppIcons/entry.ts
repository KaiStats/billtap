import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { imageUrl } = await req.json();

    // Fetch the source image
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error(`Failed to fetch image: ${imgRes.status}`);
    const imgBytes = await imgRes.arrayBuffer();

    // We'll return the raw bytes and let the frontend handle canvas resizing
    // But first, let's just confirm the image fetched OK and return its size
    return Response.json({
      success: true,
      imageUrl,
      byteLength: imgBytes.byteLength,
      message: "Image fetched successfully"
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});