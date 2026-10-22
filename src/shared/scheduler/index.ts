import { PgBoss, type Db as PgBossDb, type SendOptions } from "pg-boss";
import { OneHour, OneMinute, Queue } from "../constants";
import { startWorkers } from "./workers";
import { env } from "../env";

export class Scheduler {
  private static instance: Promise<Scheduler> | null = null;
  private stopWorkers?: () => Promise<void>;

  constructor(public readonly boss: PgBoss) {}

  static getInstance = async () => {
    Scheduler.instance ??= Scheduler.connect().catch((e) => {
      Scheduler.instance = null;
      throw e;
    });

    return Scheduler.instance;
  };

  static start = () => Scheduler.getInstance();

  static send = async (name: string, data: object, options?: SendOptions) => {
    const scheduler = await Scheduler.getInstance();
    return scheduler.boss.send(name, data, options);
  };

  static enqueueEvent = (appId: string, eventId: string, db?: PgBossDb) => {
    return Scheduler.send(Queue.EventFanout, { appId, eventId }, { db });
  };

  static enqueueSettle = (transferId: string, db?: PgBossDb) => {
    return Scheduler.send(
      Queue.SettleTransfer,
      { transferId },
      { singletonKey: transferId, db },
    );
  };

  static enqueueRefund = (transferId: string, db?: PgBossDb) => {
    return Scheduler.send(
      Queue.RefundTransfer,
      { transferId },
      { singletonKey: transferId, db },
    );
  };

  static enqueueRecover = (
    transferId: string,
    tokenAddress: string,
    db?: PgBossDb,
  ) => {
    return Scheduler.send(
      Queue.RecoverTransfer,
      { transferId, tokenAddress },
      { singletonKey: `${transferId}:${tokenAddress.toLowerCase()}`, db },
    );
  };

  static enqueueForward = (forwardId: string, db?: PgBossDb) => {
    return Scheduler.send(
      Queue.OperatorForward,
      { forwardId },
      { singletonKey: forwardId, db },
    );
  };

  private static connect = async () => {
    const boss = new PgBoss({
      connectionString: env.KITE_PG_DB_URL,
      useListenNotify: true,
      max: 20,
    });

    boss.on("error", console.error);
    boss.on("warning", console.warn);

    await boss.start();
    await boss.createQueue(Queue.EventFanout);
    await boss.createQueue(Queue.WebhookDeliveryDlq);
    await boss.createQueue(Queue.WebhookDelivery, {
      partition: true,
      notify: true,
      deleteAfterSeconds: OneHour,
      deadLetter: Queue.WebhookDeliveryDlq,
    });

    const OnchainJobQueue = {
      policy: "stately",
      retryLimit: 20,
      retryDelay: 5,
      retryBackoff: true,
      retryDelayMax: 2 * OneMinute,
      expireInSeconds: 10 * OneMinute,
    };

    await boss.createQueue(Queue.SettleTransfer, OnchainJobQueue);
    await boss.createQueue(Queue.RefundTransfer, OnchainJobQueue);
    await boss.createQueue(Queue.RecoverTransfer, OnchainJobQueue);
    await boss.createQueue(Queue.OperatorForward, OnchainJobQueue);
    await boss.createQueue(Queue.TransferSweep, {
      policy: "stately",
      retryLimit: 0,
      expireInSeconds: 5 * OneMinute,
    });

    await boss.createQueue(Queue.ApiNonceCleanup, {
      policy: "stately",
      retryLimit: 0,
      expireInSeconds: 5 * OneMinute,
    });

    await boss.schedule(Queue.TransferSweep, "* * * * *");
    await boss.schedule(Queue.ApiNonceCleanup, "*/10 * * * *");

    const scheduler = new Scheduler(boss);

    scheduler.stopWorkers = await startWorkers(boss);

    return scheduler;
  };

  stop = async () => {
    await this.boss.stop();
    await this.stopWorkers?.();
  };
}
