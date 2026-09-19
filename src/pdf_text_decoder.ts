/**
 * Zero-dependency Algorithmic PDF Stream Text Decoder
 * Extracts embedded ASCII/UTF text from raw or deflated PDF streams.
 */

export async function extractTextFromPDFBytes(pdfBytes: Uint8Array): Promise<string> {
  let extractedText = "";

  try {
    // 1. Convert to string to search for stream markers
    const decoder = new TextDecoder("latin1");
    const rawPdf = decoder.decode(pdfBytes);

    // 2. Find stream blocks: 'stream\r?\n' to '\r?\nendstream'
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let match: RegExpExecArray | null;

    while ((match = streamRegex.exec(rawPdf)) !== null) {
      const streamContent = match[1];

      // Try reading directly as text operators (BT ... ET)
      if (streamContent.includes("BT") && streamContent.includes("ET")) {
        const textFromStream = parseTextOperators(streamContent);
        if (textFromStream.trim().length > 0) {
          extractedText += textFromStream + "\n";
        }
      } else {
        // If stream is compressed (FlateDecode), attempt decompressing via DecompressionStream
        try {
          const streamStartIndex = match.index + match[0].indexOf("\n") + 1;
          const streamEndIndex = match.index + match[0].lastIndexOf("endstream");
          
          if (streamEndIndex > streamStartIndex) {
            const chunk = pdfBytes.slice(streamStartIndex, streamEndIndex);
            const decompressed = await decompressFlate(chunk);
            if (decompressed && decompressed.includes("BT")) {
              const textFromStream = parseTextOperators(decompressed);
              if (textFromStream.trim().length > 0) {
                extractedText += textFromStream + "\n";
              }
            }
          }
        } catch {
          // Continue to next stream if decompression fails
        }
      }
    }

    // 3. Fallback: If no BT/ET streams matched or was a flat PDF, extract readable text tokens
    if (extractedText.trim().length < 20) {
      extractedText = extractLiteralStringsFallback(rawPdf);
    }

  } catch {
    // Return whatever text was extracted safely
  }

  return extractedText.trim();
}

/**
 * Parses PDF text operators like Tj, TJ, ' inside BT...ET blocks
 */
function parseTextOperators(content: string): string {
  const result: string[] = [];
  const textBlockRegex = /BT([\s\S]*?)ET/g;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = textBlockRegex.exec(content)) !== null) {
    const block = blockMatch[1];
    let currentLine: string[] = [];

    // Parse single text (text) Tj
    const tjRegex = /\((.*?)\)\s*Tj/g;
    let tjMatch: RegExpExecArray | null;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      currentLine.push(unescapePdfString(tjMatch[1]));
    }

    // Parse array of text [(part1) -120 (part2)] TJ
    const tjArrayRegex = /\[([\s\S]*?)\]\s*TJ/g;
    let tjArrayMatch: RegExpExecArray | null;
    while ((tjArrayMatch = tjArrayRegex.exec(block)) !== null) {
      const arrayBody = tjArrayMatch[1];
      const partsRegex = /\((.*?)\)/g;
      let partMatch: RegExpExecArray | null;
      let linePart = "";
      while ((partMatch = partsRegex.exec(arrayBody)) !== null) {
        linePart += unescapePdfString(partMatch[1]);
      }
      if (linePart) currentLine.push(linePart);
    }

    if (currentLine.length > 0) {
      result.push(currentLine.join(" "));
    }
  }

  return result.join("\n");
}

function unescapePdfString(str: string): string {
  return str
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\b/g, "\b")
    .replace(/\\f/g, "\f")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

/**
 * Fallback extracting standard readable ascii tokens from text streams
 */
function extractLiteralStringsFallback(raw: string): string {
  const lines: string[] = [];
  const literalRegex = /\(([^\(\)\\\r\n]{3,100})\)/g;
  let match: RegExpExecArray | null;
  let count = 0;

  while ((match = literalRegex.exec(raw)) !== null && count < 200) {
    const candidate = match[1].trim();
    if (candidate.length > 2 && !candidate.startsWith("/") && !candidate.startsWith("<")) {
      lines.push(candidate);
      count++;
    }
  }

  return lines.join("\n");
}

/**
 * Native Web API DecompressionStream for Flate / Deflate streams
 */
async function decompressFlate(data: Uint8Array): Promise<string> {
  // Handle optional 2-byte zlib header (0x78 0x9c or similar)
  let bytes = data;
  if (bytes.length > 2 && bytes[0] === 0x78) {
    bytes = bytes.slice(2);
  }

  const ds = new DecompressionStream("deflate");
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();

  const response = new Response(ds.readable);
  const buffer = await response.arrayBuffer();
  return new TextDecoder("latin1").decode(buffer);
}
