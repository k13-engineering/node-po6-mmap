/* c8 ignore start */
type TMmapResult = {
  errno: number;
  address: undefined;
} | {
  errno: undefined;
  address: bigint;
};

type TLowLevelMmapArgs = {
  address: bigint;
  length: bigint;
  prot: bigint;
  flags: bigint;
  fd: bigint;
  offset: bigint;
};

type TLowLevelMmapResult = {
  errno: undefined;
  address: bigint;
} | {
  errno: number;
  address: undefined;
};

type TLowLevelMmap = (args: TLowLevelMmapArgs) => TLowLevelMmapResult;

type TLowLevelMunmapArgs = {
  address: bigint;
  length: number;
};

type TLowLevelMunmapResult = {
  errno: undefined;
} | {
  errno: number;
};

type TLowLevelMunmap = (args: TLowLevelMunmapArgs) => TLowLevelMunmapResult;

type TMmapLowLevelInterface = {
  mmap: TLowLevelMmap;
  munmap: TLowLevelMunmap;
  determinePageSize: () => number;
};

export type {
  TMmapLowLevelInterface,
  TLowLevelMmap,
  TLowLevelMunmap,
  TMmapResult,
  TLowLevelMmapArgs,
  TLowLevelMmapResult,
  TLowLevelMunmapArgs,
  TLowLevelMunmapResult,
};
/* c8 ignore end */
