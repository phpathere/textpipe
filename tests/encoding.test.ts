import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  bytesToBase64,
  storageItemByteLength,
  utf8ByteLength,
} from "../src/shared/encoding";

describe("encoding", () => {
  it("counts UTF-8 bytes instead of JavaScript characters", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("Tiếng Việt")).toBeGreaterThan("Tiếng Việt".length);
    expect(utf8ByteLength("😀")).toBe(4);
  });

  it("round-trips arbitrary bytes through base64", () => {
    const source = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
    expect(base64ToBytes(bytesToBase64(source))).toEqual(source);
  });

  it("measures Chrome sync items as key plus serialized value", () => {
    const value = { text: "xin chào" };
    expect(storageItemByteLength("key", value)).toBe(
      utf8ByteLength("key") + utf8ByteLength(JSON.stringify(value)),
    );
  });

  it("rejects malformed base64", () => {
    expect(() => base64ToBytes("%%%=")).toThrow(TypeError);
  });
});
