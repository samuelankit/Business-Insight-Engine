type PDFDocumentProxy = {
  numPages: number;
  getPage(pageNum: number): Promise<PDFPageProxy>;
};
type PDFPageProxy = {
  getTextContent(): Promise<{ items: Array<{ str: string; hasEOL?: boolean }> }>;
};

let pdfjsModule: {
  getDocument(params: { data: Uint8Array }): { promise: Promise<PDFDocumentProxy> };
} | null = null;

async function getPDFJS() {
  if (pdfjsModule) return pdfjsModule;

  if (typeof (globalThis as Record<string, unknown>).DOMMatrix === "undefined") {
    (globalThis as Record<string, unknown>).DOMMatrix = class DOMMatrix {
      constructor() {}
    };
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs" as string);
  pdfjsModule = pdfjs as typeof pdfjsModule;
  return pdfjsModule!;
}

export async function extractPDFText(buffer: Buffer): Promise<string> {
  const pdfjs = await getPDFJS();
  const data = new Uint8Array(buffer);
  const loadingTask = pdfjs.getDocument({ data });
  const doc = await loadingTask.promise;

  const textParts: string[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    let pageText = "";
    for (const item of content.items) {
      if (item.str) {
        pageText += item.str;
        if (item.hasEOL) pageText += "\n";
        else pageText += " ";
      }
    }
    textParts.push(pageText.trim());
  }

  return textParts.join("\n\n").trim();
}
