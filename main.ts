// news-image-20261125 — entry program.
//
// Copies the bundled world-news front page (entry.png) to the output
// directory as /output/entry.png. The program runs with no network and no
// dependencies, so it validates the bundled image itself before writing:
// it checks the file exists, recognises the PNG/JPEG magic bytes, enforces
// the 1 MiB size cap and the 1024x1024 dimension cap, and only then writes
// the exact bytes out. Both grader runs therefore produce identical output.

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// --- limits from the competition rules ------------------------------------
const MAX_BYTES = 1_048_576; // 1 MiB
const MAX_DIMENSION = 1024; // pixels, width and height
const OUTPUT_FILE = "entry.png";
const SOURCE_FILE = "entry.png";

// Magic bytes that identify the two formats the gate accepts.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

// Where the program writes: MAKEFUN_OUTPUT_DIR when the harness sets it,
// otherwise the grader's /output.
function outputDir(): string {
  const fromEnv = process.env.MAKEFUN_OUTPUT_DIR;
  return fromEnv && fromEnv.length > 0 ? resolve(fromEnv) : "/output";
}

// Directory holding this script (the repository root at grading time).
function repoDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

type ImageKind = "png" | "jpeg";

interface CheckedImage {
  kind: ImageKind;
  width: number;
  height: number;
  bytes: Buffer;
}

// --- format detection and dimension parsing ------------------------------

/** Identify the image format from its leading bytes, or throw. */
function detectKind(bytes: Buffer): ImageKind {
  if (bytes.length >= PNG_MAGIC.length && bytes.subarray(0, 8).equals(PNG_MAGIC)) {
    return "png";
  }
  if (bytes.length >= JPEG_MAGIC.length && bytes.subarray(0, 3).equals(JPEG_MAGIC)) {
    return "jpeg";
  }
  throw new Error("entry.png is neither a PNG nor a JPEG (bad magic bytes)");
}

/** Read width/height from a PNG IHDR chunk (bytes 16..23, big-endian). */
function pngDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 24) {
    throw new Error("PNG file too short to hold an IHDR chunk");
  }
  if (bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("PNG first chunk is not IHDR");
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Walk JPEG segments until a Start-Of-Frame marker gives the dimensions. */
function jpegDimensions(bytes: Buffer): { width: number; height: number } {
  let offset = 2; // past the SOI marker
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      throw new Error(`JPEG segment at offset ${offset} does not start with 0xFF`);
    }
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15 carry dimensions.
    const isSof =
      (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc);
    if (isSof) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    }
    if (marker === 0xd9) break; // EOI: no frame found
    offset += 2 + length;
  }
  throw new Error("JPEG has no Start-Of-Frame segment with dimensions");
}

/** Load the bundled image and enforce every gate rule on it. */
function loadAndValidate(sourcePath: string): CheckedImage {
  let size: number;
  try {
    size = statSync(sourcePath).size;
  } catch {
    throw new Error(`bundled image not found: ${sourcePath}`);
  }
  if (size === 0) throw new Error("bundled image is empty");
  if (size > MAX_BYTES) {
    throw new Error(`bundled image is ${size} bytes, over the ${MAX_BYTES} byte limit`);
  }
  const bytes = readFileSync(sourcePath);
  if (bytes.length !== size) {
    throw new Error(`bundled image changed while reading (${size} -> ${bytes.length} bytes)`);
  }
  const kind = detectKind(bytes);
  const { width, height } = kind === "png" ? pngDimensions(bytes) : jpegDimensions(bytes);
  if (width <= 0 || height <= 0) {
    throw new Error(`invalid dimensions ${width}x${height}`);
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new Error(`image is ${width}x${height}, over the ${MAX_DIMENSION}x${MAX_DIMENSION} limit`);
  }
  return { kind, width, height, bytes };
}

// --- output ---------------------------------------------------------------

/** Write the validated bytes to the output directory and confirm the write. */
function writeOutput(image: CheckedImage): string {
  const dir = outputDir();
  mkdirSync(dir, { recursive: true });
  const target = join(dir, OUTPUT_FILE);
  writeFileSync(target, image.bytes);
  // Re-read and compare so a partial write can never pass silently.
  const written = readFileSync(target);
  if (!written.equals(image.bytes)) {
    throw new Error(`verification failed: ${target} does not match the source bytes`);
  }
  return target;
}

// --- entry point ----------------------------------------------------------

function main(): void {
  const sourcePath = join(repoDir(), SOURCE_FILE);
  const image = loadAndValidate(sourcePath);
  const target = writeOutput(image);
  console.log(
    `wrote ${target}: ${image.kind} ${image.width}x${image.height}, ` +
      `${image.bytes.length} bytes`,
  );
}

main();
