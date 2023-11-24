import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import algosdk from 'algosdk';
import * as algokit from '@algorandfoundation/algokit-utils';
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
  const group = atc.buildGroup();

  const findTxnBelowRefLimit = (txns: algosdk.TransactionWithSigner[], checkAccounts: boolean = false) => {
    const txnIndex = txns.findIndex((t) => {
      const accounts = t.txn.appAccounts?.length || 0;
      if (checkAccounts) return accounts < 4;

      const assets = t.txn.appForeignAssets?.length || 0;
      const apps = t.txn.appForeignApps?.length || 0;
      const boxes = t.txn.boxes?.length || 0;

      return accounts + assets + apps + boxes < 8;
    });

    // TODO: Do this automatically?
    if (txnIndex === -1) {
      throw Error('No more transactions below reference limit. Add another app call to the group.');
    }

    return txnIndex;
  };

  const g = unnamedResourcesAccessed.group;

  if (g) {
    // TODO: Support all of these
    if (g.accounts) throw Error('Group Accounts not yet supported');
    if (g.appLocals) throw Error('Group App locals not yet supported');
    if (g.apps) throw Error('Group Apps not yet supported');
    if (g.assetHoldings) throw Error('Group asset holdings not yet supported');
    if (g.assets) throw Error('Group assets not yet supported');

    g.boxes?.forEach((b) => {
      const txnIndex = findTxnBelowRefLimit(group);
      group[txnIndex].txn.boxes?.push({ appIndex: Number(b.app), name: b.name });
    });

    if (g.extraBoxRefs) {
      for (let i = 0; i < g.extraBoxRefs; i += 1) {
        const txnIndex = findTxnBelowRefLimit(group);
        group[txnIndex].txn.boxes?.push({ appIndex: 0, name: new Uint8Array(0) });
      }
    }
  }

  unnamedResourcesAccessed.txns.forEach((r, i) => {
    if (r === undefined) return;

    if (r.boxes || r.extraBoxRefs) throw Error('Unexpected boxes at the transaction level');

    r.accounts?.forEach((a) => {
      group[i].txn.appAccounts?.push(algosdk.decodeAddress(a));
    });

    r.apps?.forEach((a) => {
      group[i].txn.appForeignApps?.push(Number(a));
    });

    r.assets?.forEach((a) => {
      group[i].txn.appForeignAssets?.push(Number(a));
    });

    // TODO: Support all of these
    if (r.appLocals) throw Error('App locals not yet supported');
    if (r.assetHoldings) throw Error('Asset holdings not yet supported');
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

    await v8Client.appClient.fundAppAccount(algokit.microAlgos(2305800));

    await v8Client.bootstrap({}, { sendParams: { fee: algokit.microAlgos(3_000) } });
  });

  let alice: algosdk.Account;

  describe('accounts', () => {
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

  describe('boxes', () => {
    test('smallBox: invalid Box reference', async () => {
      await expect(v8Client.smallBox({})).rejects.toThrow('invalid Box reference');
    });

    test('smallBox', async () => {
      const { algod } = fixture.context;
      const atc = await v8Client.compose().smallBox({}).atc();

      const packedAtc = await packResources(fixture.context.algod, atc);

      await packedAtc.execute(algod, 3);
    });

    test('mediumBox', async () => {
      const { algod } = fixture.context;
      const atc = await v8Client.compose().mediumBox({}).atc();

      const packedAtc = await packResources(fixture.context.algod, atc);

      await packedAtc.execute(algod, 3);
    });
  });

  describe('apps', () => {
    test('externalAppCall: unavailable App', async () => {
      await expect(v8Client.externalAppCall({})).rejects.toThrow('unavailable App');
    });

    test('externalAppCall', async () => {
      const { algod } = fixture.context;
      const atc = await v8Client
        .compose()
        .externalAppCall({}, { sendParams: { fee: algokit.microAlgos(2_000) } })
        .atc();

      const packedAtc = await packResources(fixture.context.algod, atc);

      await packedAtc.execute(algod, 3);
    });
  });

  describe.only('assets', () => {
    test('assetTotal: unavailable Asset', async () => {
      const { testAccount } = fixture.context;
      alice = testAccount;
      await expect(v8Client.assetTotal({ addr: testAccount.addr })).rejects.toThrow('unavailable Asset');
    });

    test('assetTotal', async () => {
      const { algod } = fixture.context;
      const atc = await v8Client.compose().assetTotal({}).atc();

      const packedAtc = await packResources(fixture.context.algod, atc);

      await packedAtc.execute(algod, 3);
    });
  });
});
