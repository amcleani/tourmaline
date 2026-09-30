import { sha256Hex, unpackDocument } from "../src/platform";
import { MemoryLibrary } from "../src/platform/memoryLibrary";

describe("sha256Hex", () => {
  it("produces lowercase hex SHA-256", async () => {
    expect(await sha256Hex(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("unpackDocument", () => {
  it("splits the JSON header from the file bytes", () => {
    const header = new TextEncoder().encode(JSON.stringify({ fileId: "f", workId: "w", name: "ä.pdf" }));
    const buffer = new ArrayBuffer(4 + header.length + 3);
    new DataView(buffer).setUint32(0, header.length, true);
    new Uint8Array(buffer, 4).set(header);
    new Uint8Array(buffer, 4 + header.length).set([37, 80, 68]);
    const { info, bytes } = unpackDocument(buffer);
    expect(info).toMatchObject({ fileId: "f", workId: "w", name: "ä.pdf" });
    expect([...bytes]).toEqual([37, 80, 68]);
  });
});

describe("memory library", () => {
  it("keeps categories' keys unique and marks removed ones deleted", () => {
    const lib = new MemoryLibrary();
    const [a, b, ...rest] = lib.listCategories();
    expect(() => lib.saveCategories([{ ...a, hotkey: 2 }, b, ...rest])).toThrow(/same key/);
    const saved = lib.saveCategories([a]);
    expect(saved.filter((c) => !c.deleted)).toHaveLength(1);
    expect(saved.find((c) => c.id === b.id)?.deleted).toBe(true);
  });
});
