import {
  createConvenienceApi,
  MemoryMappedBufferGarbageCollectedWithoutUnmapError
} from "./convenience-api.ts";
import type {
  TMemoryMappedBuffer,
  TMemoryMappedBufferInfo,
} from "./convenience-api.ts";
import { createLinuxLowLevelInterface } from "./low-level-impl-linux.ts";

const linuxLowLevelInterface = createLinuxLowLevelInterface();

const {
  mmapFd,
  determinePageSize,
} = createConvenienceApi({
  lowLevelInterface: linuxLowLevelInterface
});

export {
  mmapFd,
  determinePageSize,
  MemoryMappedBufferGarbageCollectedWithoutUnmapError
};

export type {
  TMemoryMappedBuffer,
  TMemoryMappedBufferInfo,
};
