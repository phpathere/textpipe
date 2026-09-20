import { createHash, createPublicKey } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

// Public key only. It pins one unpacked extension ID across operating systems.
// It is not a signing secret and must be replaced by the Chrome Web Store
// public key before testing a Store-distributed build.
const DEVELOPMENT_PUBLIC_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAi+qZgpHFn7Bpbh37t/QnpvgucJl+4QdgQCz1R5/xvmzVojfqO9gGvOsVgL9U3U8YyI6U0Wv7CiK0V3NEAxhCPSo7lGIvd7QP70zR5GUDnV1Z2mPTSOaO0qh++O5t9m/T99+y1eNlx4pLk6KuadmRK1bZnbPOKXqosg4IrFWT9Da96gTruRNPINi4/pVShgGx21PcfI06bkuYi/MPLeNd2Xrp30fX0O7nUbOqOCe+uGe/rTvmUK/p1V9QK3SMrTYkklDv8y1iF8tAROqaMk45LFKLYV/1CtYDpmIJNvIbjicd2Zkqlw7HVTux80zbBd76kDfYtPZSN6PfAuregEzG5QIDAQAB";
const EXPECTED_EXTENSION_ID = "khdimndigbjmblggkgjpbhkokechiedd";

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unsupported release entry: ${path}`);
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

async function createDeterministicZip(directory) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  const files = await listFiles(directory);

  if (files.length === 0 || files.length > 0xffff) {
    throw new Error(`Unsupported release file count: ${files.length}`);
  }

  for (const path of files) {
    const name = relative(directory, path).split(sep).join("/");
    const nameBytes = Buffer.from(name, "utf8");
    const data = await readFile(path);
    const compressed = deflateRawSync(data, { level: 9 });
    const checksum = crc32(data);

    if (nameBytes.length > 0xffff || data.length > 0xffffffff || compressed.length > 0xffffffff) {
      throw new Error(`ZIP64 would be required for: ${name}`);
    }

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0x0021, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBytes, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x0021, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, nameBytes);

    localOffset += localHeader.length + nameBytes.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  if (localOffset > 0xffffffff || centralDirectory.length > 0xffffffff) {
    throw new Error("ZIP64 would be required for this release package.");
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

const root = resolve(import.meta.dirname, "..");
const source = join(root, "dist");
const sourceManifest = JSON.parse(await readFile(join(source, "manifest.json"), "utf8"));
if (sourceManifest.key !== undefined) {
  throw new Error("Production manifest already has a key; refusing to overwrite it.");
}

const localeNames = (await readdir(join(source, "_locales"))).sort();
if (JSON.stringify(localeNames) !== JSON.stringify(["en", "vi"])) {
  throw new Error(`Unexpected locale directories: ${localeNames.join(", ")}`);
}

const releaseDirectory = join(root, "release");
const artifactName = `textpipe-${sourceManifest.version}-cross-device`;
const storeArtifactName = `textpipe-${sourceManifest.version}-chrome-web-store`;
const target = join(releaseDirectory, `${artifactName}-unpacked`);
const stagedTarget = join(releaseDirectory, `.${artifactName}-unpacked-${process.pid}.tmp`);
const zipPath = join(releaseDirectory, `${artifactName}.zip`);
const stagedZipPath = join(releaseDirectory, `.${artifactName}-${process.pid}.zip.tmp`);
const storeZipPath = join(releaseDirectory, `${storeArtifactName}.zip`);
const stagedStoreZipPath = join(releaseDirectory, `.${storeArtifactName}-${process.pid}.zip.tmp`);
const checksumPath = join(releaseDirectory, "SHA256SUMS.txt");
const manifestPath = join(stagedTarget, "manifest.json");

await rm(releaseDirectory, { recursive: true, force: true });
await mkdir(releaseDirectory, { recursive: true });

const publicKeyDer = Buffer.from(DEVELOPMENT_PUBLIC_KEY, "base64");
const publicKey = createPublicKey({ key: publicKeyDer, format: "der", type: "spki" });
if (
  publicKey.asymmetricKeyType !== "rsa" ||
  (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
) {
  throw new Error("Development key must be an RSA public key of at least 2048 bits.");
}

sourceManifest.key = DEVELOPMENT_PUBLIC_KEY;

const digest = createHash("sha256").update(publicKeyDer).digest().subarray(0, 16);
const extensionId = [...digest]
  .flatMap((byte) => [byte >> 4, byte & 0x0f])
  .map((nibble) => String.fromCharCode("a".charCodeAt(0) + nibble))
  .join("");

if (extensionId !== EXPECTED_EXTENSION_ID) {
  throw new Error(
    `Pinned extension ID mismatch: expected ${EXPECTED_EXTENSION_ID}, calculated ${extensionId}`,
  );
}

try {
  await cp(source, stagedTarget, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(sourceManifest, null, 2)}\n`, "utf8");

  const [crossDeviceZip, storeZip] = await Promise.all([
    createDeterministicZip(stagedTarget),
    createDeterministicZip(source),
  ]);
  await Promise.all([
    writeFile(stagedZipPath, crossDeviceZip),
    writeFile(stagedStoreZipPath, storeZip),
  ]);
  const crossDeviceDigest = createHash("sha256").update(crossDeviceZip).digest("hex");
  const storeDigest = createHash("sha256").update(storeZip).digest("hex");

  await rm(target, { recursive: true, force: true });
  await rm(zipPath, { force: true });
  await rm(storeZipPath, { force: true });
  await rename(stagedTarget, target);
  await rename(stagedZipPath, zipPath);
  await rename(stagedStoreZipPath, storeZipPath);
  await writeFile(
    checksumPath,
    `${crossDeviceDigest}  ${artifactName}.zip\n${storeDigest}  ${storeArtifactName}.zip\n`,
    "utf8",
  );

  console.log(`Cross-device unpacked package: ${target}`);
  console.log(`Cross-device ZIP package: ${zipPath}`);
  console.log(`Chrome Web Store ZIP package: ${storeZipPath}`);
  console.log(`Cross-device SHA-256: ${crossDeviceDigest}`);
  console.log(`Chrome Web Store SHA-256: ${storeDigest}`);
  console.log(`Pinned development extension ID: ${extensionId}`);
} finally {
  await rm(stagedTarget, { recursive: true, force: true });
  await rm(stagedZipPath, { force: true });
  await rm(stagedStoreZipPath, { force: true });
}
