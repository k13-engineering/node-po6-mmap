const MAX_64BIT = BigInt("0xFFFFFFFFFFFFFFFF");

const formatPointer = ({ pointerAddress }: { pointerAddress: bigint }) => {
  try {
    if (pointerAddress < BigInt(0)) {
      throw Error("pointer address cannot be negative");
    }

    if (pointerAddress > MAX_64BIT) {
      throw Error("pointer address exceeds 64-bit range");
    }
  } catch (ex) {
    throw Error("invalid pointer address", { cause: ex });
  }

  const hexString = pointerAddress.toString(16).toUpperCase();
  const paddedHexString = hexString.padStart(16, "0");
  return `0x${paddedHexString}`;
};

export {
  formatPointer
};
