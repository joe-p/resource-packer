import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import algosdk from 'algosdk';
import * as algokit from '@algorandfoundation/algokit-utils';
import { ResourcePackerv8Client } from '../contracts/clients/ResourcePackerv8Client';
import { ResourcePackerv9Client } from '../contracts/clients/ResourcePackerv9Client';
import { ExternalAppClient } from '../contracts/clients/ExternalAppClient';

async function getUnnamedResourcesAccessed(algod: algosdk.Algodv2, atc: algosdk.AtomicTransactionComposer) {
  const simReq = new algosdk.modelsv2.SimulateRequest({
    txnGroups: [],
    allowUnnamedResources: true,
  });

  const result = await atc.simulate(algod, simReq);

  const groupResponse = result.simulateResponse.txnGroups[0];

  if (groupResponse.failureMessage) {
    throw Error(
      `Error during resource packing simulation in transaction ${groupResponse.failedAt}: ${groupResponse.failureMessage}`
    );
  }

  return {
    group: groupResponse.unnamedResourcesAccessed,
    txns: groupResponse.txnResults.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (t: any) => t.unnamedResourcesAccessed
    ) as algosdk.modelsv2.SimulateUnnamedResourcesAccessed[],
  };
}

async function packResources(algod: algosdk.Algodv2, atc: algosdk.AtomicTransactionComposer) {
  const unnamedResourcesAccessed = await getUnnamedResourcesAccessed(algod, atc);
  const group = atc.buildGroup();

  const findTxnBelowRefLimit = (
    txns: algosdk.TransactionWithSigner[],
    type: 'account' | 'assetHolding' | 'other' = 'other'
  ) => {
    const txnIndex = txns.findIndex((t) => {
      const accounts = t.txn.appAccounts?.length || 0;
      if (type === 'account') return accounts < 4;

      const assets = t.txn.appForeignAssets?.length || 0;
      const apps = t.txn.appForeignApps?.length || 0;
      const boxes = t.txn.boxes?.length || 0;

      if (type === 'assetHolding') {
        return accounts + assets + apps + boxes < 7 && accounts < 4;
      }

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
    g.appLocals?.forEach((a) => {
      const txnIndex = findTxnBelowRefLimit(group, 'assetHolding');
      group[txnIndex].txn.appForeignApps?.push(Number(a.app));
      group[txnIndex].txn.appAccounts?.push(algosdk.decodeAddress(a.account));
    });

    g.assetHoldings?.forEach((a) => {
      const txnIndex = findTxnBelowRefLimit(group, 'assetHolding');
      group[txnIndex].txn.appForeignAssets?.push(Number(a.asset));
      group[txnIndex].txn.appAccounts?.push(algosdk.decodeAddress(a.account));
    });

    g.boxes?.forEach((b) => {
      const txnIndex = findTxnBelowRefLimit(group);
      group[txnIndex].txn.boxes?.push({ appIndex: Number(b.app), name: b.name });
    });

    g.assets?.forEach((a) => {
      const txnIndex = findTxnBelowRefLimit(group);
      group[txnIndex].txn.appForeignAssets?.push(Number(a));
    });

    g.accounts?.forEach((a) => {
      const txnIndex = findTxnBelowRefLimit(group, 'account');
      group[txnIndex].txn.appAccounts?.push(algosdk.decodeAddress(a));
    });

    g.apps?.forEach((a) => {
      const txnIndex = findTxnBelowRefLimit(group);
      group[txnIndex].txn.appForeignApps?.push(Number(a));
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
    if (r.appLocals) throw Error('Unexpected app local at the transaction level');
    if (r.assetHoldings) throw Error('Unexpected asset holding at the transaction level');

    r.accounts?.forEach((a) => {
      group[i].txn.appAccounts?.push(algosdk.decodeAddress(a));
    });

    r.apps?.forEach((a) => {
      group[i].txn.appForeignApps?.push(Number(a));
    });

    r.assets?.forEach((a) => {
      group[i].txn.appForeignAssets?.push(Number(a));
    });
  });

  const newAtc = new algosdk.AtomicTransactionComposer();

  group.forEach((t) => {
    // eslint-disable-next-line no-param-reassign
    t.txn.group = undefined;
    newAtc.addTransaction(t);
  });

  return newAtc;
}
const tests = (version: 8 | 9) => () => {
  const fixture = algorandFixture();

  let appClient: ResourcePackerv8Client | ResourcePackerv9Client;

  let externalClient: ExternalAppClient;

  beforeEach(fixture.beforeEach);

  beforeAll(async () => {
    await fixture.beforeEach();
    const { algod, testAccount } = fixture.context;

    if (version === 8) {
      appClient = new ResourcePackerv8Client(
        {
          sender: testAccount,
          resolveBy: 'id',
          id: 0,
        },
        algod
      );
    } else {
      appClient = new ResourcePackerv9Client(
        {
          sender: testAccount,
          resolveBy: 'id',
          id: 0,
        },
        algod
      );
    }

    await appClient.create.createApplication({});

    await appClient.appClient.fundAppAccount(algokit.microAlgos(2305800));

    await appClient.bootstrap({}, { sendParams: { fee: algokit.microAlgos(3_000) } });

    externalClient = new ExternalAppClient(
      {
        sender: testAccount,
        resolveBy: 'id',
        id: (await appClient.getGlobalState()).externalAppID!.asBigInt(),
      },
      algod
    );
  });

  let alice: algosdk.Account;

  describe('accounts', () => {
    test('addressBalance: invalid Account reference', async () => {
      const { testAccount } = fixture.context;
      alice = testAccount;
      await expect(appClient.addressBalance({ addr: testAccount.addr })).rejects.toThrow('invalid Account reference');
    });

    test('addressBalance', async () => {
      const { algod, testAccount } = fixture.context;
      const atc = await appClient
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
      await expect(appClient.smallBox({})).rejects.toThrow('invalid Box reference');
    });

    test('smallBox', async () => {
      const { algod } = fixture.context;
      const atc = await appClient.compose().smallBox({}).atc();

      const packedAtc = await packResources(fixture.context.algod, atc);

      await packedAtc.execute(algod, 3);
    });

    test('mediumBox', async () => {
      const { algod } = fixture.context;
      const atc = await appClient.compose().mediumBox({}).atc();

      const packedAtc = await packResources(fixture.context.algod, atc);

      await packedAtc.execute(algod, 3);
    });
  });

  describe('apps', () => {
    test('externalAppCall: unavailable App', async () => {
      await expect(appClient.externalAppCall({})).rejects.toThrow('unavailable App');
    });

    test('externalAppCall', async () => {
      const { algod } = fixture.context;
      const atc = await appClient
        .compose()
        .externalAppCall({}, { sendParams: { fee: algokit.microAlgos(2_000) } })
        .atc();

      const packedAtc = await packResources(fixture.context.algod, atc);

      await packedAtc.execute(algod, 3);
    });
  });

  describe('assets', () => {
    test('assetTotal: unavailable Asset', async () => {
      const { testAccount } = fixture.context;
      alice = testAccount;
      await expect(appClient.assetTotal({})).rejects.toThrow('unavailable Asset');
    });

    test('assetTotal', async () => {
      const { algod } = fixture.context;
      const atc = await appClient.compose().assetTotal({}).atc();

      const packedAtc = await packResources(fixture.context.algod, atc);

      await packedAtc.execute(algod, 3);
    });
  });

  describe('cross-product references', () => {
    const hasAssetErrorMsg = version === 8 ? 'invalid Account reference' : 'unavailable Account';

    test(`hasAsset: ${hasAssetErrorMsg}`, async () => {
      const { testAccount } = fixture.context;
      alice = testAccount;
      await expect(appClient.hasAsset({ addr: testAccount.addr })).rejects.toThrow(hasAssetErrorMsg);
    });

    test('hasAsset', async () => {
      const { algod, testAccount } = fixture.context;
      const atc = await appClient.compose().hasAsset({ addr: testAccount.addr }).atc();

      const packedAtc = await packResources(fixture.context.algod, atc);

      await packedAtc.execute(algod, 3);
    });

    test(`externalLocal: ${hasAssetErrorMsg}`, async () => {
      const { testAccount } = fixture.context;
      alice = testAccount;
      await expect(appClient.externalLocal({ addr: testAccount.addr })).rejects.toThrow(hasAssetErrorMsg);
    });

    test('externalLocal', async () => {
      const { algod, testAccount } = fixture.context;
      await externalClient.optIn.optInToApplication({}, { sender: testAccount });
      const atc = await appClient.compose().externalLocal({ addr: testAccount.addr }).atc();

      const packedAtc = await packResources(fixture.context.algod, atc);

      await packedAtc.execute(algod, 3);
    });
  });
};

describe('Resource Packer: AVM8', tests(8));
describe('Resource Packer: AVM9', tests(9));

describe('meta', () => {
  const fixture = algorandFixture();

  let externalClient: ExternalAppClient;

  beforeEach(fixture.beforeEach);

  beforeAll(async () => {
    await fixture.beforeEach();
    const { testAccount, algod } = fixture.context;

    externalClient = new ExternalAppClient(
      {
        sender: testAccount,
        resolveBy: 'id',
        id: 0,
      },
      algod
    );

    await externalClient.create.createApplication({});
  });

  test('error during simulate', async () => {
    const atc = await externalClient.compose().error({}).atc();

    await expect(packResources(fixture.context.algod, atc)).rejects.toThrow(
      'Error during resource packing simulation in transaction 0'
    );
  });
});
