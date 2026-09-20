export const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch (error) {
    throw new TypeError("Giá trị base64 không hợp lệ.", { cause: error });
  }
}

export function decodeUtf8(bytes: ArrayBuffer): string {
  return textDecoder.decode(bytes);
}

export function storageItemByteLength(key: string, value: unknown): number {
  return utf8ByteLength(key) + utf8ByteLength(JSON.stringify(value));
}
