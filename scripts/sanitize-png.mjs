import { readFile, rename, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SAFE_CHUNKS = new Set(["IHDR", "IDAT", "IEND"]);

function fail(path, message) {
  throw new Error(`${basename(path)}: ${message}`);
}

async function sanitize(path) {
  const source = await readFile(path);
  if (source.length < PNG_SIGNATURE.length || !source.subarray(0, 8).equals(PNG_SIGNATURE)) {
    fail(path, "not a PNG file");
  }

  const output = [PNG_SIGNATURE];
  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;

  while (offset < source.length && !sawEnd) {
    if (offset + 12 > source.length) fail(path, "truncated PNG chunk");
    const length = source.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > source.length) fail(path, "PNG chunk exceeds file bounds");

    const type = source.toString("ascii", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/u.test(type)) fail(path, `invalid chunk type ${JSON.stringify(type)}`);

    if (type === "IHDR") {
      if (sawHeader || offset !== PNG_SIGNATURE.length || length !== 13) {
        fail(path, "invalid IHDR placement or length");
      }
      width = source.readUInt32BE(offset + 8);
      height = source.readUInt32BE(offset + 12);
      const bitDepth = source[offset + 16];
      const colorType = source[offset + 17];
      const compression = source[offset + 18];
      const filter = source[offset + 19];
      const interlace = source[offset + 20];
      if (!width || !height) fail(path, "invalid zero-sized image");
      if (
        bitDepth !== 8 ||
        colorType !== 6 ||
        compression !== 0 ||
        filter !== 0 ||
        interlace !== 0
      ) {
        fail(path, "logo PNG must be non-interlaced 8-bit RGBA");
      }
      sawHeader = true;
    } else if (type === "IDAT") {
      if (!sawHeader || sawEnd) fail(path, "invalid IDAT placement");
      sawImageData = true;
    } else if (type === "IEND") {
      if (!sawImageData || length !== 0) fail(path, "invalid IEND chunk");
      sawEnd = true;
    } else if ((type.charCodeAt(0) & 32) === 0) {
      fail(path, `unsupported critical chunk ${type}`);
    }

    if (SAFE_CHUNKS.has(type)) output.push(source.subarray(offset, chunkEnd));
    offset = chunkEnd;
  }

  if (!sawHeader || !sawImageData || !sawEnd) fail(path, "missing required PNG chunks");

  const sanitized = Buffer.concat(output);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, sanitized);
  await rename(temporary, path);
  console.log(
    `${basename(path)}: ${width}x${height}, ${source.length} -> ${sanitized.length} bytes`,
  );
}

const inputs = process.argv.slice(2);
if (inputs.length === 0) {
  throw new Error("Usage: node scripts/sanitize-png.mjs <png> [png ...]");
}

for (const input of inputs) await sanitize(resolve(input));
