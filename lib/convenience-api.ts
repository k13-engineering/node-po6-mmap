import { address2buffer } from "buffer2address";
import nodeFs from "node:fs";
import { formatPointer } from "./snippets/format-pointer.ts";
import type { TMmapLowLevelInterface } from "./low-level-interface.ts";

type TMemoryMappingVisibility = "MAP_SHARED" | "MAP_PRIVATE";

type TMemoryProtectionFlags = {
  PROT_EXEC: boolean;
  PROT_READ: boolean;
  PROT_WRITE: boolean;
};

type TGenericMmapFlags = {
  MAP_32BIT: boolean;
  MAP_LOCKED: boolean;
  MAP_NORESERVE: boolean;
};

const PROT_READ = BigInt(0x1);
const PROT_WRITE = BigInt(0x2);
const PROT_EXEC = BigInt(0x4);

const memoryProtectionFlagsToSyscallValue = ({ memoryProtectionFlags }: { memoryProtectionFlags: TMemoryProtectionFlags }) => {
  let flagsParameter = BigInt(0);

  if (memoryProtectionFlags.PROT_READ) {
    flagsParameter = flagsParameter | PROT_READ;
  }

  if (memoryProtectionFlags.PROT_WRITE) {
    flagsParameter = flagsParameter | PROT_WRITE;
  }

  if (memoryProtectionFlags.PROT_EXEC) {
    flagsParameter = flagsParameter | PROT_EXEC;
  }

  return flagsParameter;
};

const MAP_PRIVATE = BigInt(0x02);
const MAP_SHARED_VALIDATE = BigInt(0x03);

const mappingVisibilityToMmapFlags = ({ mappingVisibility }: { mappingVisibility: TMemoryMappingVisibility }) => {
  let flagsParameter = BigInt(0);

  if (mappingVisibility === "MAP_PRIVATE") {
    flagsParameter = flagsParameter | MAP_PRIVATE;
  } else if (mappingVisibility === "MAP_SHARED") {
    flagsParameter = flagsParameter | MAP_SHARED_VALIDATE;
  }

  return flagsParameter;
};

const MAP_32BIT = BigInt(0x40);
const MAP_LOCKED = BigInt(0x2000);
const MAP_NORESERVE = BigInt(0x4000);

const genericFlagsToMmapFlags = ({ genericFlags }: { genericFlags: Partial<TGenericMmapFlags> }) => {
  let flagsParameter = BigInt(0);

  if (genericFlags.MAP_32BIT === true) {
    flagsParameter = flagsParameter | MAP_32BIT;
  }

  if (genericFlags.MAP_LOCKED === true) {
    flagsParameter = flagsParameter | MAP_LOCKED;
  }

  if (genericFlags.MAP_NORESERVE === true) {
    flagsParameter = flagsParameter | MAP_NORESERVE;
  }

  return flagsParameter;
};

type TMemoryMappedBufferInfo = {
  address: bigint;
  length: number;
};

type TMemoryMapping = {
  address: bigint;
  length: number;

  createArrayBuffer: () => ArrayBuffer;

  unmap: () => void;
};

class MemoryMappedBufferGarbageCollectedWithoutUnmapError extends Error {

  public bufferInfo: TMemoryMappedBufferInfo;

  constructor ({ bufferInfo }: { bufferInfo: TMemoryMappedBufferInfo }) {
    let message = `memory mapped buffer at`;
    message += ` address ${formatPointer({ pointerAddress: bufferInfo.address })}`;
    message += ` with length ${bufferInfo.length}`;
    message += ` was garbage collected without calling unmap().`;
    message += ` This would causes a memory leak -`;
    message += ` therefore this raises an uncaught exception.`;
    message += ` Please make sure to call unmap() on all memory mapped buffers when you are done with them.`;

    super(message);

    this.bufferInfo = bufferInfo;
    this.name = "MemoryMappedBufferGarbageCollectedWithoutUnmapError";
  }
};

const mappedBuffersFinalizationRegistry = new FinalizationRegistry((bufferInfo: TMemoryMappedBufferInfo) => {
  // This callback is called when a buffer is garbage collected without unmap() being called

  throw new MemoryMappedBufferGarbageCollectedWithoutUnmapError({ bufferInfo });
});


type TMmapFdResult = {
  errno: number;
  mapping: undefined;
} | {
  errno: undefined;
  mapping: TMemoryMapping;
};

const assertFdIsValid = ({ fd }: { fd: number }) => {
  if (fd < 0) {
    throw Error(`invalid file descriptor ${fd}`);
  }

  try {
    nodeFs.fstatSync(fd);
  } catch (ex) {
    throw Error(`invalid file descriptor ${fd}, fstat failed`, { cause: ex });
  }
};

const createConvenienceApi = ({
  lowLevelInterface
}: {
  lowLevelInterface: TMmapLowLevelInterface;
}) => {

  const { mmap, munmap } = lowLevelInterface;

  // help type inference
  const determinePageSize = lowLevelInterface.determinePageSize as () => number;

  const assertMmapParameters = ({
    offsetInFd,
    length,
  }: {
    offsetInFd: number;
    length: number;
  }) => {

    const pageSize = determinePageSize();

    if (offsetInFd % pageSize !== 0) {
      throw Error(`offsetInFd must be multiple of page size ${pageSize}`);
    }

    if (length <= 0) {
      throw Error(`length must be greater than zero`);
    }
  };

  const memoryMappingFromAddress = ({
    address,
    length,
  }: {
    address: bigint;
    length: number;
  }): TMemoryMapping => {
    let mapped = true;
    const token = {};

    const unmap = () => {
      if (!mapped) {
        throw Error(`memory mapping already unmapped`);
      }

      const { errno } = munmap({ address, length });
      if (errno !== undefined) {
        throw Error(`munmap failed with errno ${errno}`);
      }

      mapped = false;

      // Unregister from finalization registry since we properly unmapped
      mappedBuffersFinalizationRegistry.unregister(token);
    };

    const bufferInfo: TMemoryMappedBufferInfo = {
      address,
      length,
    };

    // Register the buffer to detect if it's garbage collected without unmap()
    mappedBuffersFinalizationRegistry.register(unmap, bufferInfo, token);

    const createArrayBuffer = (): ArrayBuffer => {
      if (!mapped) {
        throw Error(`memory mapping already unmapped`);
      }

      const buffer = address2buffer({ address, size: length });
      const backingArrayBuffer = buffer.buffer;

      if (!(backingArrayBuffer instanceof ArrayBuffer)) {
        throw Error(`internal error: expected ArrayBuffer as backing buffer`);
      }

      return backingArrayBuffer;
    };

    return {
      address,
      length,
      createArrayBuffer,
      unmap
    };
  };

  const mmapFd = ({
    fd,
    mappingVisibility,
    memoryProtectionFlags,
    genericFlags,
    offsetInFd,
    length,
  }: {
    fd: number;
    mappingVisibility: TMemoryMappingVisibility;
    memoryProtectionFlags: TMemoryProtectionFlags;
    genericFlags: Partial<TGenericMmapFlags>;
    offsetInFd: number;
    length: number;
  }): TMmapFdResult => {

    assertMmapParameters({ offsetInFd, length });

    const addressParam = BigInt(0);
    const lengthParam = BigInt(length);
    const protParam = memoryProtectionFlagsToSyscallValue({ memoryProtectionFlags });

    let flagsParam = BigInt(0);
    flagsParam |= mappingVisibilityToMmapFlags({ mappingVisibility });
    flagsParam |= genericFlagsToMmapFlags({ genericFlags });

    assertFdIsValid({ fd });
    const fdParam = BigInt(fd);
    const offsetParam = BigInt(offsetInFd);

    const { errno, address: mappedAddress } = mmap({
      address: addressParam,
      length: lengthParam,
      prot: protParam,
      flags: flagsParam,
      fd: fdParam,
      offset: offsetParam,
    });

    if (errno !== undefined) {
      return {
        errno,
        mapping: undefined,
      };
    }

    const mapping = memoryMappingFromAddress({
      address: mappedAddress,
      length,
    });

    return {
      errno: undefined,
      mapping,
    };
  };

  return {
    mmapFd,
    determinePageSize
  };
};

type TMmapConvenienceApi = ReturnType<typeof createConvenienceApi>;
type TMmapFdFunc = TMmapConvenienceApi["mmapFd"];
type TDeterminePageSizeFunc = TMmapConvenienceApi["determinePageSize"];

export {
  createConvenienceApi,
  MemoryMappedBufferGarbageCollectedWithoutUnmapError
};

export type {
  TMmapConvenienceApi,
  TMemoryMapping,
  TMemoryMappingVisibility,
  TMemoryProtectionFlags,
  TGenericMmapFlags,
  TMemoryMappedBufferInfo,
  TMmapFdResult,
  TMmapFdFunc,
  TDeterminePageSizeFunc,
};
