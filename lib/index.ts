import {
  createConvenienceApi,
  MemoryMappedBufferGarbageCollectedWithoutUnmapError
} from "./convenience-api.ts";
import type {
  TDeterminePageSizeFunc,
  TMemoryMappedBuffer,
  TMemoryMappedBufferInfo,
  TMmapFdFunc,
  TGenericMmapFlags,
  TMemoryMappingVisibility,
  TMemoryProtectionFlags,
} from "./convenience-api.ts";
import { createLinuxLowLevelInterface } from "./low-level-impl-linux.ts";

const linuxLowLevelInterface = createLinuxLowLevelInterface();

const convenienceApi = createConvenienceApi({
  lowLevelInterface: linuxLowLevelInterface
});

const mmapFd = convenienceApi.mmapFd as TMmapFdFunc;
const determinePageSize = convenienceApi.determinePageSize as TDeterminePageSizeFunc;

export {
  mmapFd,
  determinePageSize,
  createConvenienceApi,
  MemoryMappedBufferGarbageCollectedWithoutUnmapError
};

export type {
  TMemoryMappedBuffer,
  TMemoryMappedBufferInfo,
  TMemoryMappingVisibility,
  TMemoryProtectionFlags,
  TGenericMmapFlags,
};
