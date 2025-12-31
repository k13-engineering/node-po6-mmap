import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { mmapFd, determinePageSize } from "../lib/index.ts";

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
      assert.ok(result.buffer !== undefined);
      assert.strictEqual(result.buffer.length, 4096);

      // Verify we can read the data
      assert.strictEqual(result.buffer[0], 0);
      assert.strictEqual(result.buffer[1], 1);
      assert.strictEqual(result.buffer[255], 255);

      // Clean up
      result.buffer.unmap();
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
        assert.ok(result.buffer !== undefined);
        assert.strictEqual(result.buffer.length, length, `Buffer length should be ${length}`);

        result.buffer.unmap();
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
      assert.ok(result.buffer !== undefined);

      // Should be able to write
      result.buffer[0] = 42;
      assert.strictEqual(result.buffer[0], 42);

      result.buffer.unmap();
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
      assert.ok(result.buffer !== undefined);

      result.buffer.unmap();
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
      assert.ok(result.buffer !== undefined);

      // Verify we're reading from the correct offset
      assert.strictEqual(result.buffer[0], pageSize % 256);
      assert.strictEqual(result.buffer[1], (pageSize + 1) % 256);

      result.buffer.unmap();
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
      assert.ok(result.buffer !== undefined);
      assert.strictEqual(result.buffer.length, testFileSize);

      // Verify every byte matches the well-known pattern (i % 256)
      for (let i = 0; i < testFileSize; i += 1) {
        assert.strictEqual(
          result.buffer[i],
          i % 256,
          `Byte at offset ${i} should be ${i % 256} but got ${result.buffer[i]}`
        );
      }

      result.buffer.unmap();
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
      assert.ok(result.buffer !== undefined);

      // First unmap should succeed
      result.buffer.unmap();

      // Second unmap should throw an exception
      assert.throws(() => {
        result.buffer.unmap();
      }, {
        message: "memory already unmapped"
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
      assert.ok(result.buffer !== undefined);
      assert.strictEqual(typeof result.buffer.address, "bigint");
      assert.ok(result.buffer.address > BigInt(0));

      result.buffer.unmap();
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
      assert.ok(result.buffer !== undefined);
      assert.strictEqual(typeof result.buffer.unmap, "function");

      result.buffer.unmap();
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
      assert.ok(result.buffer !== undefined);
      assert.strictEqual(result.buffer.length, testFileSize - pageSize);

      result.buffer.unmap();
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
      assert.ok(result.buffer !== undefined);
      assert.strictEqual(result.buffer.length, pageSize);

      result.buffer.unmap();
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
      assert.ok(result.buffer !== undefined);

      result.buffer.unmap();
    });
  });
});
