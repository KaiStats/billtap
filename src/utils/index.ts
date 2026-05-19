export function createPageUrl(pageName: string) {
    // Handle paths that already include query strings (e.g. "ReceiptDetail?id=123&host=1")
    const qIdx = pageName.indexOf('?');
    if (qIdx !== -1) {
        const base = pageName.slice(0, qIdx).replace(/ /g, '-');
        const query = pageName.slice(qIdx);
        return '/' + base + query;
    }
    return '/' + pageName.replace(/ /g, '-');
}