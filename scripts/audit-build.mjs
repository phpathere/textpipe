import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { crc32 } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
const manifestPath = join(dist, "manifest.json");
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

function assert(condition, message) {
  if (!condition) throw new Error(`Build audit failed: ${message}`);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert(manifest.manifest_version === 3, "manifest_version must be 3");
assert(manifest.version === packageJson.version, "manifest and package versions must match");
assert(/^\d+\.\d+\.\d+$/u.test(manifest.version), "version must be a three-part number");
assert(Number(manifest.minimum_chrome_version) >= 127, "minimum Chrome version regressed");
assert(
  JSON.stringify(manifest.permissions) === JSON.stringify(["storage", "alarms", "contextMenus"]),
  "permission allowlist changed",
);
assert(manifest.optional_permissions === undefined, "optional permissions are not allowed");
assert(manifest.host_permissions === undefined, "host_permissions are not allowed");
assert(
  manifest.optional_host_permissions === undefined,
  "optional host permissions are not allowed",
);
assert(manifest.content_scripts === undefined, "content scripts are not allowed");
assert(manifest.web_accessible_resources === undefined, "web-accessible resources are not allowed");
assert(
  manifest.externally_connectable === undefined,
  "externally_connectable is not used; external listeners are prohibited separately",
);
assert(manifest.update_url === undefined, "custom update URLs are not allowed");
assert(manifest.incognito === "not_allowed", "incognito must remain disabled");
assert(manifest.background?.service_worker === "background.js", "service worker entry changed");
assert(manifest.background?.type === "module", "service worker must remain an ES module");
assert(manifest.action?.default_popup === "popup.html", "popup entry changed");
assert(manifest.options_ui?.page === "options.html", "options entry changed");

const expectedCsp =
  "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
assert(
  JSON.stringify(manifest.content_security_policy) ===
    JSON.stringify({ extension_pages: expectedCsp }),
  "extension CSP must exactly match the audited allowlist",
);
assert(manifest.key === undefined, "the production build must not contain a development key");

const requiredFiles = [
  "popup.html",
  "options.html",
  "background.js",
  "_locales/vi/messages.json",
  "_locales/en/messages.json",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
  "third-party-licenses/Plus-Jakarta-Sans-OFL-1.1.txt",
];
for (const file of requiredFiles) {
  await stat(join(dist, file));
}

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const expectedPngs = new Map([
  [join(dist, "icons/icon-16.png"), { file: "icons/icon-16.png", size: 16 }],
  [join(dist, "icons/icon-32.png"), { file: "icons/icon-32.png", size: 32 }],
  [join(dist, "icons/icon-48.png"), { file: "icons/icon-48.png", size: 48 }],
  [join(dist, "icons/icon-128.png"), { file: "icons/icon-128.png", size: 128 }],
  [
    join(root, "assets/brand/textpipe-logo-master.png"),
    { file: "assets/brand/textpipe-logo-master.png", size: 1254 },
  ],
]);

for (const [path, { file, size: expectedSize }] of expectedPngs) {
  const content = await readFile(path);
  assert(content.subarray(0, 8).equals(pngSignature), `${file} must have a valid PNG signature`);

  let offset = pngSignature.length;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;
  while (offset < content.length && !sawEnd) {
    assert(offset + 12 <= content.length, `${file} contains a truncated PNG chunk`);
    const length = content.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    assert(chunkEnd <= content.length, `${file} contains an out-of-bounds PNG chunk`);

    const type = content.toString("ascii", typeStart, dataStart);
    assert(["IHDR", "IDAT", "IEND"].includes(type), `${file} contains metadata chunk ${type}`);
    const expectedCrc = content.readUInt32BE(dataEnd);
    const actualCrc = crc32(content.subarray(typeStart, dataEnd));
    assert(actualCrc === expectedCrc, `${file} contains a PNG CRC mismatch`);

    if (type === "IHDR") {
      assert(!sawHeader && offset === 8 && length === 13, `${file} has an invalid IHDR`);
      assert(
        content.readUInt32BE(dataStart) === expectedSize &&
          content.readUInt32BE(dataStart + 4) === expectedSize,
        `${file} must be exactly ${expectedSize}x${expectedSize}`,
      );
      assert(content[dataStart + 8] === 8, `${file} must use 8-bit channels`);
      assert(content[dataStart + 9] === 6, `${file} must use RGBA color`);
      sawHeader = true;
    } else if (type === "IDAT") {
      assert(sawHeader, `${file} has IDAT before IHDR`);
      sawImageData = true;
    } else {
      assert(sawImageData && length === 0, `${file} has an invalid IEND`);
      sawEnd = true;
    }
    offset = chunkEnd;
  }
  assert(sawHeader && sawImageData && sawEnd, `${file} is missing a required PNG chunk`);
  assert(offset === content.length, `${file} contains trailing data after IEND`);
}

const files = await walk(dist);
assert(!files.some((file) => file.endsWith(".map")), "source maps must not ship");
assert(!files.some((file) => file.endsWith(".svg")), "unreferenced SVG source must not ship");

const expectedFonts = new Map([
  [
    "plus-jakarta-sans-latin-wght-normal",
    "153fc85b70298beeb1d61a5f723331649e7f23bb77302a66e61cb3e2fbdb5e79",
  ],
  [
    "plus-jakarta-sans-latin-ext-wght-normal",
    "38e3b8fd8045048eb311d90170a4429ed2c8f405852dc3d91b5af8452758703f",
  ],
  [
    "plus-jakarta-sans-vietnamese-wght-normal",
    "b275d1258601dda240fc6a1d4a6cad56e691d898f5cdf1b0e4fd6ca0022d8e40",
  ],
]);
const fontFiles = files.filter((file) => file.endsWith(".woff2"));
assert(fontFiles.length === expectedFonts.size, "exactly three audited WOFF2 subsets must ship");
for (const [name, expectedSha256] of expectedFonts) {
  const file = fontFiles.find((candidate) => relative(dist, candidate).includes(name));
  assert(file, `missing audited font subset ${name}`);
  const content = await readFile(file);
  assert(content.subarray(0, 4).toString("ascii") === "wOF2", `${name} has an invalid signature`);
  assert(content.readUInt32BE(8) === content.length, `${name} has an invalid declared length`);
  assert(
    createHash("sha256").update(content).digest("hex") === expectedSha256,
    `${name} differs from the audited upstream file`,
  );
}
assert(
  !files.some((file) => /\.(?:woff|ttf|otf)$/u.test(file)),
  "unaudited font formats must not ship",
);

const fontLicense = await readFile(
  join(dist, "third-party-licenses/Plus-Jakarta-Sans-OFL-1.1.txt"),
);
assert(
  createHash("sha256").update(fontLicense).digest("hex") ===
    "e07fd1167c2aaaa6fb965dd66e1e73b13c9c95b76b2d648b6e938780f30b37af",
  "font license must exactly match the audited upstream package",
);

const textFiles = files.filter((file) => /\.(?:js|mjs|html|css|json)$/u.test(file));
const forbiddenPatterns = [
  [/https?:\/\//u, "remote URL"],
  [/@import\b/u, "CSS import"],
  [/url\(\s*["']?(?:data:|blob:|\/\/)/u, "non-local CSS asset URL"],
  [/\beval\s*\(/u, "eval"],
  [/\bnew\s+Function\b/u, "new Function"],
  [/document\.write/u, "document.write"],
  [/\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(/u, "network primitive"],
  [/google-analytics|googletagmanager|segment\.com|sentry\.io/iu, "telemetry endpoint"],
];

let totalBytes = 0;
for (const file of files) totalBytes += (await stat(file)).size;
for (const file of textFiles) {
  const content = await readFile(file, "utf8");
  const auditableContent = content.replace(
    /http:\/\/www\.w3\.org\/(?:2000\/svg|1998\/Math\/MathML|1999\/xhtml)/gu,
    "allowed-dom-namespace",
  );
  for (const [pattern, label] of forbiddenPatterns) {
    assert(!pattern.test(auditableContent), `${label} found in ${relative(dist, file)}`);
  }
  if (file.endsWith(".html")) {
    const scripts = [...content.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)];
    for (const script of scripts) {
      assert(/\bsrc=/u.test(script[1] ?? ""), `inline script found in ${relative(dist, file)}`);
      assert(
        (script[2] ?? "").trim() === "",
        `inline script body found in ${relative(dist, file)}`,
      );
    }
  }
}

const sourceFiles = (await walk(join(root, "src"))).filter((file) => /\.tsx?$/u.test(file));
for (const file of sourceFiles) {
  const content = await readFile(file, "utf8");
  for (const [pattern, label] of [
    [/dangerouslySetInnerHTML/u, "dangerouslySetInnerHTML"],
    [/\.innerHTML\s*=/u, "innerHTML assignment"],
    [/document\.write/u, "document.write"],
    [/onMessageExternal/u, "external message listener"],
    [/onConnectExternal/u, "external connection listener"],
  ]) {
    assert(!pattern.test(content), `${label} found in ${relative(root, file)}`);
  }
}

assert(totalBytes < 250_000, `package is unexpectedly large (${totalBytes} bytes)`);
console.log(
  `Build audit passed: ${files.length} files, ${totalBytes.toLocaleString("en-US")} bytes, 3 permissions, no host access or remote code.`,
);
