import { AsyncLocalStorage } from "node:async_hooks";

const transactionHashObserver = new AsyncLocalStorage<
  (transactionHash: string) => Promise<void>
>();

export const withX402TransactionHashObserver = <T>(
  observer: (transactionHash: string) => Promise<void>,
  operation: () => Promise<T>,
) => transactionHashObserver.run(observer, operation);

export const reportX402TransactionHash = async (transactionHash: string) => {
  const observer = transactionHashObserver.getStore();
  if (observer) await observer(transactionHash);
};
