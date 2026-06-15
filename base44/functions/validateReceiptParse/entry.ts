import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { items, tax, tip, total } = await req.json();

    if (!items || !Array.isArray(items)) {
      return Response.json({ error: 'Invalid items array' }, { status: 400 });
    }

    // Validation 1: Sum check with 5 cent tolerance
    const itemSum = items.reduce((s, i) => s + (i.price * (i.quantity || 1)), 0);
    const calculatedTotal = itemSum + (tax || 0) + (tip || 0);
    const tolerance = 0.05;
    const difference = Math.abs(calculatedTotal - total);
    const sumMismatch = difference > tolerance;

    // Validation 2: Flag suspicious patterns
    const suspiciousPatterns = [];
    
    // Check for unusually high prices
    if (items.some(i => i.price > 500)) {
      suspiciousPatterns.push("Unusually high item price detected");
    }
    
    // Check for too many items
    if (items.length > 50) {
      suspiciousPatterns.push("Unusually high number of items");
    }
    
    // Check tax ratio
    if (tax && itemSum > 0 && tax > itemSum * 0.2) {
      suspiciousPatterns.push("Tax amount seems unusually high");
    }
    
    // Check tip ratio
    if (tip && itemSum > 0 && tip > itemSum * 0.5) {
      suspiciousPatterns.push("Tip amount seems unusually high");
    }

    // Validation 3: Check for OCR error patterns
    const ocrErrorPatterns = [];
    
    items.forEach(item => {
      // Check for price format errors (e.g., "1299" instead of "12.99")
      if (typeof item.price === 'number' && item.price > 1000) {
        ocrErrorPatterns.push(`Possible price format error on "${item.name}" ($${item.price})`);
      }
      
      // Check for garbage item names
      if (item.name && item.name.length > 80) {
        ocrErrorPatterns.push(`Item name too long - possible OCR error: "${item.name.substring(0, 30)}..."`);
      }
      
      // Check for negative prices
      if (item.price < 0) {
        ocrErrorPatterns.push(`Negative price on "${item.name}"`);
      }
    });

    // Calculate confidence score
    let confidence = 'high';
    if (sumMismatch || suspiciousPatterns.length > 2) {
      confidence = 'low';
    } else if (suspiciousPatterns.length > 0 || ocrErrorPatterns.length > 0) {
      confidence = 'medium';
    }

    const isValid = !sumMismatch && ocrErrorPatterns.length === 0;

    return Response.json({
      valid: isValid,
      confidence,
      issues: {
        sumMismatch,
        calculatedTotal: Math.round(calculatedTotal * 100) / 100,
        expectedTotal: total,
        difference: Math.round(difference * 100) / 100,
        suspiciousPatterns,
        ocrErrorPatterns
      },
      details: {
        itemCount: items.length,
        itemSubtotal: Math.round(itemSum * 100) / 100,
        taxAmount: tax || 0,
        tipAmount: tip || 0
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});