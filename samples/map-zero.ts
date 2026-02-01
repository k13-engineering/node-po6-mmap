import { mmapFd, determinePageSize } from "../lib/index.ts";
import nodeFs from "node:fs";

const fd = nodeFs.openSync("/dev/zero", "r+");

const length = determinePageSize();

const { errno, buffer } = mmapFd({
  fd,
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

nodeFs.closeSync(fd);

if (errno !== undefined) {
  throw Error(`mmapFd failed with errno ${errno}`);
}

console.log(`mapped buffer of length ${buffer.byteLength} at address 0x${buffer.address.toString(16)}`);
console.log(`buffer:`, buffer);

buffer.unmap();
