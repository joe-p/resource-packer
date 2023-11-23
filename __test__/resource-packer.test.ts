import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import algosdk from 'algosdk';
import { ResourcePackerv8Client } from '../contracts/clients/ResourcePackerv8Client';

async function getUnnamedResourcesAccessed(algod: algosdk.Algodv2, atc: algosdk.AtomicTransactionComposer) {
  const simReq = new algosdk.modelsv2.SimulateRequest({
    txnGroups: [],
    allowUnnamedResources: true,
  });

  // TODO: handle logic errors somehow... maybe throwing an error?
  const result = await atc.simulate(algod, simReq);

  return {
    group: result.simulateResponse.txnGroups[0].unnamedResourcesAccessed,
    txns: result.simulateResponse.txnGroups[0].txnResults.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (t: any) => t.unnamedResourcesAccessed
    ) as algosdk.modelsv2.SimulateUnnamedResourcesAccessed[],
  };
}

async function packResources(algod: algosdk.Algodv2, atc: algosdk.AtomicTransactionComposer) {
  const unnamedResourcesAccessed = await getUnnamedResourcesAccessed(algod, atc);

  // TODO: support group sharing
  if (unnamedResourcesAccessed.group !== undefined) throw Error('Group sharing not yet supported');

  const group = atc.buildGroup();

  unnamedResourcesAccessed.txns.forEach((r, i) => {
    (r.accounts || []).forEach((a) => {
      group[i].txn.appAccounts?.push(algosdk.decodeAddress(a));
    });

    // TODO: Support all of these
    if (r.appLocals) throw Error('App locals not yet supported');
    if (r.apps) throw Error('Apps not yet supported');
    if (r.assetHoldings) throw Error('Asset holdings not yet supported');
    if (r.assets) throw Error('Assets not yet supported');
    if (r.boxes) throw Error('Boxes not yet supported');
    if (r.extraBoxRefs) throw Error('Extra box refs not yet supported');
  });

  const newAtc = new algosdk.AtomicTransactionComposer();

  group.forEach((t) => {
    // eslint-disable-next-line no-param-reassign
    t.txn.group = undefined;
    newAtc.addTransaction(t);
  });

  return newAtc;
}

describe('ResourcePacker', () => {
  const fixture = algorandFixture();

  let v8Client: ResourcePackerv8Client;

  beforeEach(fixture.beforeEach);

  beforeAll(async () => {
    await fixture.beforeEach();
    const { algod, testAccount } = fixture.context;

    v8Client = new ResourcePackerv8Client(
      {
        sender: testAccount,
        resolveBy: 'id',
        id: 0,
      },
      algod
    );

    await v8Client.create.createApplication({});
  });

  let alice: algosdk.Account;

  test('addressBalance: invalid Account reference', async () => {
    const { testAccount } = fixture.context;
    alice = testAccount;
    await expect(v8Client.addressBalance({ addr: testAccount.addr })).rejects.toThrow('invalid Account reference');
  });

  test('addressBalance', async () => {
    const { algod, testAccount } = fixture.context;
    const atc = await v8Client
      .compose()
      .addressBalance({ addr: testAccount.addr })
      .addressBalance({ addr: alice.addr })
      .atc();

    const packedAtc = await packResources(fixture.context.algod, atc);

    await packedAtc.execute(algod, 3);
  });
});
