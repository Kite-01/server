import { describe, expect, it } from "vitest";
import { StrKey, xdr } from "@stellar/stellar-sdk";
import { simulationError } from "../StellarActor";

const FACTORY = "CA7OSTMOZ5LSMQYSKXONCDKCPHVCNEF6E2IK7GUX2IX4C65RLUDCFLMK";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

const errorEvent = (contract: string, error: xdr.ScError) =>
  new xdr.DiagnosticEvent({
    inSuccessfulContractCall: false,
    event: new xdr.ContractEvent({
      ext: new xdr.ExtensionPoint(0),
      contractId: StrKey.decodeContract(contract) as never,
      type: xdr.ContractEventType.diagnostic(),
      body: new xdr.ContractEventBody(
        0,
        new xdr.ContractEventV0({
          topics: [xdr.ScVal.scvSymbol("error"), xdr.ScVal.scvError(error)],
          data: xdr.ScVal.scvVoid(),
        }),
      ),
    }),
  });

describe("simulationError", () => {
  it("blames the contract that raised the final error, past one a try_ call recovered", () => {
    const error = simulationError({
      error: "HostError: Error(Contract, #13)",
      events: [
        // the factory's try_get_status on a deposit not deployed yet
        errorEvent(
          FACTORY,
          xdr.ScError.sceStorage(xdr.ScErrorCode.scecMissingValue()),
        ),
        errorEvent(USDC, xdr.ScError.sceContract(13)),
        errorEvent(FACTORY, xdr.ScError.sceContract(13)),
      ],
    } as never);

    expect(error.contract).toBe(USDC);
    expect(error.code).toBe(13);
  });
});
