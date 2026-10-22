import { AsyncLocalStorage } from "node:async_hooks";

export type x402_Observer = {
  onSubmitted(callId: string): Promise<void>;
  onBroadcast(transactionHash: string): Promise<void>;
};

const storage = new AsyncLocalStorage<x402_Observer>();

export const getX402Observer = () => storage.getStore();
export const withX402Observer = <T>(
  observer: x402_Observer,
  operation: () => Promise<T>,
) => {
  return storage.run(observer, operation);
};
