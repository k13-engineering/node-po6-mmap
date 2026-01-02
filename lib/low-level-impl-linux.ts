import { syscall, syscallNumbers } from "syscall-napi";
import type { TLowLevelMmap, TLowLevelMunmap, TMmapLowLevelInterface } from "./low-level-interface.ts";

const createLinuxLowLevelInterface = (): TMmapLowLevelInterface => {
  const mmap: TLowLevelMmap = ({
    address,
    length,
    prot,
    flags,
    fd,
    offset,
  }) => {
    const { errno, ret } = syscall({
      syscallNumber: syscallNumbers.mmap,
      args: [
        address,
        length,
        prot,
        flags,
        fd,
        offset,
      ]
    });

    if (errno !== undefined) {
      return {
        errno,
        address: undefined
      };
    }

    return {
      errno: undefined,
      address: ret
    };
  };

  const munmap: TLowLevelMunmap = ({
    address,
    length,
  }: {
    address: bigint;
    length: number;
  }) => {
    const { errno } = syscall({
      syscallNumber: syscallNumbers.munmap,
      args: [
        address,
        BigInt(length),
      ]
    });

    return {
      errno
    };
  };

  const determinePageSize = () => {
    // this is wrong, yet it works on majority of systems
    // TODO: improve
    return 4096;
  };

  return {
    mmap,
    munmap,
    determinePageSize,
  };
};

export {
  createLinuxLowLevelInterface
};
