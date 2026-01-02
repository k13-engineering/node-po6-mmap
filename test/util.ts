import { mmapFd } from "../lib/index.ts";
import nodeFs from "node:fs";

const captureUncaughtExceptionsDuring = async (fn: (args: { uncaughtExceptions: () => Error[] }) => Promise<void>): Promise<Error[]> => {

  let uncaughtExceptions: Error[] = [];

  const uncaughtExceptionListener = (ex: Error) => {
    uncaughtExceptions = [
      ...uncaughtExceptions,
      ex
    ];
  };

  const previousListeners = process.listeners("uncaughtException");
  previousListeners.forEach((listener) => {
    process.off("uncaughtException", listener);
  });

  process.on("uncaughtException", uncaughtExceptionListener);

  try {
    await fn({
      uncaughtExceptions: () => {
        return uncaughtExceptions;
      }
    });
  } finally {
    process.off("uncaughtException", uncaughtExceptionListener);
    previousListeners.forEach((listener) => {
      process.on("uncaughtException", listener);
    });
  }

  return uncaughtExceptions;
};

const forceGarbageCollection = () => {
  if (gc === undefined) {
    throw Error(`please run with --expose-gc`);
  }

  gc();
};

const mapZero = ({ length }: { length: number }) => {

  const fd = nodeFs.openSync("/dev/zero", "r+");

  const { errno, buffer } = mmapFd({
    fd,
    mappingVisibility: "MAP_PRIVATE",
    memoryProtectionFlags: {
      PROT_READ: true,
      PROT_WRITE: true,
      PROT_EXEC: false,
    },
    genericFlags: {},
    offsetInFd: 0,
    length,
  });

  if (errno !== undefined) {
    throw Error(`mmapFd failed with errno ${errno}`);
  }

  return buffer;
};

export {
  captureUncaughtExceptionsDuring,
  forceGarbageCollection,
  mapZero,
};
