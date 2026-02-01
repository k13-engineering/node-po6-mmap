import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  mmapFd,
  determinePageSize,
  type TMemoryMappedBufferInfo,
  MemoryMappedBufferGarbageCollectedWithoutUnmapError
} from "../lib/index.ts";
import { captureUncaughtExceptionsDuring, forceGarbageCollection, mapZero } from "./util.ts";
import { formatPointer } from "../lib/snippets/format-pointer.ts";
import { createConvenienceApi, type TMmapFdResult } from "../lib/convenience-api.ts";
import { createLinuxLowLevelInterface } from "../lib/low-level-impl-linux.ts";

describe("node-po6-mmap", () => {
  let tmpDir: string;
  let testFilePath: string;
  let testFd: number;
  const testFileSize = 2 * 4096;

  before(() => {
    // Create a temporary directory and test file
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mmap-test-"));
    testFilePath = path.join(tmpDir, "test-file.bin");

    // Create a test file with some data
    const buffer = Buffer.alloc(testFileSize);
    for (let i = 0; i < testFileSize; i += 1) {
      buffer[i] = i % 256;
    }
    fs.writeFileSync(testFilePath, buffer);

    // Open file descriptor for tests
    testFd = fs.openSync(testFilePath, "r+");
  });

  after(() => {
    // Clean up
    if (testFd !== undefined) {
      fs.closeSync(testFd);
    }
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("determinePageSize", () => {
    it("should return a valid page size", () => {
      const pageSize = determinePageSize();
      assert.strictEqual(typeof pageSize, "number");
      assert.ok(pageSize > 0);
      assert.ok(pageSize % 4096 === 0 || pageSize === 4096);
    });
  });

  describe("mmapFd - successful mappings", () => {
    it("should successfully map a file", () => {
      const result = mmapFd({
        fd: testFd,
        mappingVisibility: "MAP_PRIVATE",
        memoryProtectionFlags: {
          PROT_READ: true,
          PROT_WRITE: false,
          PROT_EXEC: false,
        },
        genericFlags: {},
        offsetInFd: 0,
        length: 4096,
      });

      assert.strictEqual(result.errno, undefined);
      assert.ok(result.mapping !== undefined);
      assert.strictEqual(result.mapping.length, 4096);

      // Verify we can read the data
      const buffer = result.mapping.createArrayBuffer();
      const view = new Uint8Array(buffer);
      assert.strictEqual(view[0], 0);
      assert.strictEqual(view[1], 1);
      assert.strictEqual(view[255], 255);

      // Clean up
      result.mapping.unmap();
    });

    it("should return correct length of buffer", () => {
      const lengths = [4096, 8192];

      for (const length of lengths) {
        const result = mmapFd({
          fd: testFd,
          mappingVisibility: "MAP_PRIVATE",
          memoryProtectionFlags: {
            PROT_READ: true,
            PROT_WRITE: false,
            PROT_EXEC: false,
          },
          genericFlags: {},
          offsetInFd: 0,
          length,
        });

        assert.strictEqual(result.errno, undefined);
        assert.ok(result.mapping !== undefined);
        assert.strictEqual(result.mapping.length, length, `Buffer length should be ${length}`);

        result.mapping.unmap();
      }
    });

    it("should map with different protection flags", () => {
      const result = mmapFd({
        fd: testFd,
        mappingVisibility: "MAP_PRIVATE",
        memoryProtectionFlags: {
          PROT_READ: true,
          PROT_WRITE: true,
          PROT_EXEC: false,
        },
        genericFlags: {},
        offsetInFd: 0,
        length: 4096,
      });

      assert.strictEqual(result.errno, undefined);
      assert.ok(result.mapping !== undefined);

      // Should be able to write
      const buffer = result.mapping.createArrayBuffer();
      const view = new Uint8Array(buffer);
      view[0] = 42;
      assert.strictEqual(view[0], 42);

      result.mapping.unmap();
    });

    it("should map with MAP_SHARED visibility", () => {
      const result = mmapFd({
        fd: testFd,
        mappingVisibility: "MAP_SHARED",
        memoryProtectionFlags: {
          PROT_READ: true,
          PROT_WRITE: false,
          PROT_EXEC: false,
        },
        genericFlags: {},
        offsetInFd: 0,
        length: 4096,
      });

      assert.strictEqual(result.errno, undefined);
      assert.ok(result.mapping !== undefined);

      result.mapping.unmap();
    });

    it("should map with different offsets", () => {
      const pageSize = determinePageSize();
      const result = mmapFd({
        fd: testFd,
        mappingVisibility: "MAP_PRIVATE",
        memoryProtectionFlags: {
          PROT_READ: true,
          PROT_WRITE: false,
          PROT_EXEC: false,
        },
        genericFlags: {},
        offsetInFd: pageSize,
        length: pageSize,
      });

      assert.strictEqual(result.errno, undefined);
      assert.ok(result.mapping !== undefined);

      // Verify we're reading from the correct offset
      const buffer = result.mapping.createArrayBuffer();
      const view = new Uint8Array(buffer);
      assert.strictEqual(view[0], pageSize % 256);
      assert.strictEqual(view[1], (pageSize + 1) % 256);

      result.mapping.unmap();
    });

    it("should contain the well-known file contents in the mapped buffer", () => {
      const result = mmapFd({
        fd: testFd,
        mappingVisibility: "MAP_PRIVATE",
        memoryProtectionFlags: {
          PROT_READ: true,
          PROT_WRITE: false,
          PROT_EXEC: false,
        },
        genericFlags: {},
        offsetInFd: 0,
        length: testFileSize,
      });

      assert.strictEqual(result.errno, undefined);
      assert.ok(result.mapping !== undefined);
      assert.strictEqual(result.mapping.length, testFileSize);

      // Verify every byte matches the well-known pattern (i % 256)
      const buffer = result.mapping.createArrayBuffer();
      const view = new Uint8Array(buffer);
      for (let i = 0; i < testFileSize; i += 1) {
        assert.strictEqual(
          view[i],
          i % 256,
          `Byte at offset ${i} should be ${i % 256} but got ${view[i]}`
        );
      }

      result.mapping.unmap();
    });
  });

  describe("mmapFd - exception scenarios (not errno)", () => {
    it("should throw exception when calling unmap twice", () => {
      const result = mmapFd({
        fd: testFd,
        mappingVisibility: "MAP_PRIVATE",
        memoryProtectionFlags: {
          PROT_READ: true,
          PROT_WRITE: false,
          PROT_EXEC: false,
        },
        genericFlags: {},
        offsetInFd: 0,
        length: 4096,
      });

      assert.strictEqual(result.errno, undefined);
      assert.ok(result.mapping !== undefined);

      // First unmap should succeed
      result.mapping.unmap();

      // Second unmap should throw an exception
      assert.throws(() => {
        result.mapping.unmap();
      }, {
        message: "memory mapping already unmapped"
      });
    });

    it("should throw exception with wrong offset values (not page-aligned)", () => {
      const pageSize = determinePageSize();

      assert.throws(() => {
        mmapFd({
          fd: testFd,
          mappingVisibility: "MAP_PRIVATE",
          memoryProtectionFlags: {
            PROT_READ: true,
            PROT_WRITE: false,
            PROT_EXEC: false,
          },
          genericFlags: {},
          offsetInFd: 100,
          length: 4096,
        });
      }, {
        message: `offsetInFd must be multiple of page size ${pageSize}`
      });
    });

    it("should throw exception with zero-sized length", () => {
      assert.throws(() => {
        mmapFd({
          fd: testFd,
          mappingVisibility: "MAP_PRIVATE",
          memoryProtectionFlags: {
            PROT_READ: true,
            PROT_WRITE: false,
            PROT_EXEC: false,
          },
          genericFlags: {},
          offsetInFd: 0,
          length: 0,
        });
      }, {
        message: "length must be greater than zero"
      });
    });

    it("should throw exception with negative length", () => {
      assert.throws(() => {
        mmapFd({
          fd: testFd,
          mappingVisibility: "MAP_PRIVATE",
          memoryProtectionFlags: {
            PROT_READ: true,
            PROT_WRITE: false,
            PROT_EXEC: false,
          },
          genericFlags: {},
          offsetInFd: 0,
          length: -4096,
        });
      }, {
        message: "length must be greater than zero"
      });
    });

    it("should throw exception with negative file descriptor", () => {
      assert.throws(() => {
        mmapFd({
          fd: -1,
          mappingVisibility: "MAP_PRIVATE",
          memoryProtectionFlags: {
            PROT_READ: true,
            PROT_WRITE: false,
            PROT_EXEC: false,
          },
          genericFlags: {},
          offsetInFd: 0,
          length: 4096,
        });
      }, {
        message: "invalid file descriptor -1"
      });
    });

    it("should throw exception with invalid file descriptor (e.g., 5000)", () => {
      assert.throws(() => {
        mmapFd({
          fd: 5000,
          mappingVisibility: "MAP_PRIVATE",
          memoryProtectionFlags: {
            PROT_READ: true,
            PROT_WRITE: false,
            PROT_EXEC: false,
          },
          genericFlags: {},
          offsetInFd: 0,
          length: 4096,
        });
      }, (err: Error) => {
        // Check that the error message includes "invalid file descriptor 5000"
        return err.message.includes("invalid file descriptor 5000");
      });
    });

    it("should throw exception with various invalid file descriptors", () => {
      const invalidFds = [999, 1234, 10000];

      for (const fd of invalidFds) {
        assert.throws(() => {
          mmapFd({
            fd,
            mappingVisibility: "MAP_PRIVATE",
            memoryProtectionFlags: {
              PROT_READ: true,
              PROT_WRITE: false,
              PROT_EXEC: false,
            },
            genericFlags: {},
            offsetInFd: 0,
            length: 4096,
          });
        }, (err: Error) => {
          return err.message.includes(`invalid file descriptor ${fd}`);
        });
      }
    });
  });

  describe("buffer properties", () => {
    it("should have address property on mapped buffer", () => {
      const result = mmapFd({
        fd: testFd,
        mappingVisibility: "MAP_PRIVATE",
        memoryProtectionFlags: {
          PROT_READ: true,
          PROT_WRITE: false,
          PROT_EXEC: false,
        },
        genericFlags: {},
        offsetInFd: 0,
        length: 4096,
      });

      assert.strictEqual(result.errno, undefined);
      assert.ok(result.mapping !== undefined);
      assert.strictEqual(typeof result.mapping.address, "bigint");
      assert.ok(result.mapping.address > BigInt(0));

      result.mapping.unmap();
    });

    it("should have unmap method on mapped buffer", () => {
      const result = mmapFd({
        fd: testFd,
        mappingVisibility: "MAP_PRIVATE",
        memoryProtectionFlags: {
          PROT_READ: true,
          PROT_WRITE: false,
          PROT_EXEC: false,
        },
        genericFlags: {},
        offsetInFd: 0,
        length: 4096,
      });

      assert.strictEqual(result.errno, undefined);
      assert.ok(result.mapping !== undefined);
      assert.strictEqual(typeof result.mapping.unmap, "function");

      result.mapping.unmap();
    });
  });

  describe("edge cases", () => {
    it("should handle maximum offset within file bounds", () => {
      const pageSize = determinePageSize();
      const result = mmapFd({
        fd: testFd,
        mappingVisibility: "MAP_PRIVATE",
        memoryProtectionFlags: {
          PROT_READ: true,
          PROT_WRITE: false,
          PROT_EXEC: false,
        },
        genericFlags: {},
        offsetInFd: pageSize,
        length: testFileSize - pageSize,
      });

      assert.strictEqual(result.errno, undefined);
      assert.ok(result.mapping !== undefined);
      assert.strictEqual(result.mapping.length, testFileSize - pageSize);

      result.mapping.unmap();
    });

    it("should handle single page mapping", () => {
      const pageSize = determinePageSize();
      const result = mmapFd({
        fd: testFd,
        mappingVisibility: "MAP_PRIVATE",
        memoryProtectionFlags: {
          PROT_READ: true,
          PROT_WRITE: false,
          PROT_EXEC: false,
        },
        genericFlags: {},
        offsetInFd: 0,
        length: pageSize,
      });

      assert.strictEqual(result.errno, undefined);
      assert.ok(result.mapping !== undefined);
      assert.strictEqual(result.mapping.length, pageSize);

      result.mapping.unmap();
    });
  });

  describe("generic flags", () => {
    it("should map with MAP_NORESERVE flag", () => {
      const result = mmapFd({
        fd: testFd,
        mappingVisibility: "MAP_PRIVATE",
        memoryProtectionFlags: {
          PROT_READ: true,
          PROT_WRITE: false,
          PROT_EXEC: false,
        },
        genericFlags: {
          MAP_NORESERVE: true,
        },
        offsetInFd: 0,
        length: 4096,
      });

      assert.strictEqual(result.errno, undefined);
      assert.ok(result.mapping !== undefined);

      result.mapping.unmap();
    });

    it("should map with MAP_32BIT flag", () => {
      const result = mmapFd({
        fd: testFd,
        mappingVisibility: "MAP_PRIVATE",
        memoryProtectionFlags: {
          PROT_READ: true,
          PROT_WRITE: false,
          PROT_EXEC: false,
        },
        genericFlags: {
          MAP_32BIT: true,
        },
        offsetInFd: 0,
        length: 4096,
      });

      assert.ok(result.mapping !== undefined);
      // When MAP_32BIT succeeds, the address should be in the 32-bit range
      assert.ok(result.mapping.address < BigInt(0x100000000), "Address should be in 32-bit range");

      result.mapping.unmap();
    });

    it("should map with MAP_LOCKED flag", () => {
      const result = mmapFd({
        fd: testFd,
        mappingVisibility: "MAP_PRIVATE",
        memoryProtectionFlags: {
          PROT_READ: true,
          PROT_WRITE: false,
          PROT_EXEC: false,
        },
        genericFlags: {
          MAP_LOCKED: true,
        },
        offsetInFd: 0,
        length: 4096,
      });

      assert.ok(result.mapping !== undefined);
      assert.strictEqual(result.mapping.length, 4096);

      result.mapping.unmap();
    });
  });

  describe("PROT_EXEC flag", () => {
    it("should map with PROT_EXEC flag", () => {
      const result = mmapFd({
        fd: testFd,
        mappingVisibility: "MAP_PRIVATE",
        memoryProtectionFlags: {
          PROT_READ: true,
          PROT_WRITE: false,
          PROT_EXEC: true,
        },
        genericFlags: {},
        offsetInFd: 0,
        length: 4096,
      });

      assert.strictEqual(result.errno, undefined);
      assert.ok(result.mapping !== undefined);
      assert.strictEqual(result.mapping.length, 4096);

      // Should be able to read the data
      const buffer = result.mapping.createArrayBuffer();
      const view = new Uint8Array(buffer);
      assert.strictEqual(view[0], 0);
      assert.strictEqual(view[1], 1);

      result.mapping.unmap();
    });

    it("should map with PROT_READ, PROT_WRITE, and PROT_EXEC all enabled", () => {
      const result = mmapFd({
        fd: testFd,
        mappingVisibility: "MAP_PRIVATE",
        memoryProtectionFlags: {
          PROT_READ: true,
          PROT_WRITE: true,
          PROT_EXEC: true,
        },
        genericFlags: {},
        offsetInFd: 0,
        length: 4096,
      });

      assert.strictEqual(result.errno, undefined);
      assert.ok(result.mapping !== undefined);

      // Should be able to read and write
      const buffer = result.mapping.createArrayBuffer();
      const view = new Uint8Array(buffer);
      const originalValue = view[0];
      view[0] = 123;
      assert.strictEqual(view[0], 123);
      view[0] = originalValue;

      result.mapping.unmap();
    });
  });

  describe("errno scenarios", () => {
    it("should return errno when trying to map non-mappable fd", () => {
      // stdin is typically not mappable
      const stdinFd = 0;

      const result = mmapFd({
        fd: stdinFd,
        mappingVisibility: "MAP_PRIVATE",
        memoryProtectionFlags: {
          PROT_READ: true,
          PROT_WRITE: false,
          PROT_EXEC: false,
        },
        genericFlags: {},
        offsetInFd: 0,
        length: determinePageSize(),
      });

      if (result.errno === undefined) {
        result.mapping.unmap();
      }

      assert.ok(result.errno !== undefined, "errno should be set");
      assert.ok(result.errno > 0, "errno should be a positive number");
      assert.strictEqual(result.mapping, undefined);
    });

    it("should throw exception when munmap fails", async () => {

      const EINVAL = 22;

      const linuxLowLevelInterface = createLinuxLowLevelInterface();

      const convenienceApi = createConvenienceApi({
        lowLevelInterface: {
          mmap: linuxLowLevelInterface.mmap,
          munmap: ({ address, length }) => {
            const { errno } = linuxLowLevelInterface.munmap({
              address,
              length
            });

            assert.ok(errno === undefined);

            return {
              errno: EINVAL
            };
          },
          determinePageSize: linuxLowLevelInterface.determinePageSize,
        }
      });

      let mapResult: TMmapFdResult | undefined = convenienceApi.mmapFd({
        fd: testFd,
        mappingVisibility: "MAP_PRIVATE",
        memoryProtectionFlags: {
          PROT_READ: true,
          PROT_WRITE: false,
          PROT_EXEC: false,
        },
        genericFlags: {},
        offsetInFd: 0,
        length: 4096,
      });

      assert.strictEqual(mapResult!.errno, undefined);
      assert.ok(mapResult!.mapping !== undefined);

      assert.throws(() => {
        mapResult!.mapping!.unmap();
      }, {
        message: `munmap failed with errno ${EINVAL}`
      });

      const capturedUncaughtExceptions = await captureUncaughtExceptionsDuring(async ({ uncaughtExceptions }) => {
        // remove reference to buffer to allow garbage collection
        mapResult = undefined;

        const startedAt = performance.now();

        while (performance.now() - startedAt < 3000) {
          forceGarbageCollection();
          await new Promise((resolve) => setTimeout(resolve, 20));

          const exceptions = uncaughtExceptions();
          if (exceptions.length > 0) {
            return;
          }
        }
      });

      assert.strictEqual(capturedUncaughtExceptions.length, 1);
    });
  });

  describe("memory leak detection", () => {
    it("should throw exception when buffer is garbage collected without unmap", async function () {
      this.timeout(5000);

      if (global.gc === undefined) {
        this.skip();
        return;
      }

      const length = determinePageSize() * 2;

      let mapping: ReturnType<typeof mapZero> | undefined = mapZero({ length });

      const bufferInfo: TMemoryMappedBufferInfo = {
        address: mapping.address,
        length: mapping.length,
      };

      const capturedUncaughtExceptions = await captureUncaughtExceptionsDuring(async ({ uncaughtExceptions }) => {
        // remove reference to mapping to allow garbage collection
        mapping = undefined;

        const startedAt = performance.now();

        while (performance.now() - startedAt < 3000) {
          forceGarbageCollection();
          await new Promise((resolve) => setTimeout(resolve, 20));

          const exceptions = uncaughtExceptions();
          if (exceptions.length > 0) {
            return;
          }
        }
      });

      assert.strictEqual(capturedUncaughtExceptions.length, 1);

      const ex = capturedUncaughtExceptions[0];
      assert.ok(ex instanceof MemoryMappedBufferGarbageCollectedWithoutUnmapError);
      assert.strictEqual(ex.bufferInfo.address, bufferInfo.address);
      assert.strictEqual(ex.bufferInfo.length, bufferInfo.length);

      assert.ok(ex.message.includes(formatPointer({ pointerAddress: bufferInfo.address })));
      assert.ok(ex.message.includes(`length ${bufferInfo.length}`));
    });
  });
});
