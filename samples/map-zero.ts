import { mmapFd, determinePageSize } from "../lib/index.ts";
import nodeFs from "node:fs";

const fd = nodeFs.openSync("/dev/zero", "r+");

const length = determinePageSize();

const { errno, mapping } = mmapFd({
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

console.log(`mapped buffer of length ${mapping.length} at address 0x${mapping.address.toString(16)}`);
console.log(`buffer:`, mapping.createArrayBuffer());

mapping.unmap();
