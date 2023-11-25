import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import algosdk from 'algosdk';
import * as algokit from '@algorandfoundation/algokit-utils';
import { ResourcePackerv8Client } from '../contracts/clients/ResourcePackerv8Client';
import { ResourcePackerv9Client } from '../contracts/clients/ResourcePackerv9Client';
import { ExternalAppClient } from '../contracts/clients/ExternalAppClient';
import { packResources } from '../src';

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
describe('Resource Packer: Mixed', () => {
  const fixture = algorandFixture();

  let v9Client: ResourcePackerv9Client;

  let v8Client: ResourcePackerv8Client;

  beforeEach(fixture.beforeEach);

  beforeAll(async () => {
    await fixture.beforeEach();
    const { algod, testAccount } = fixture.context;

    v9Client = new ResourcePackerv9Client(
      {
        sender: testAccount,
        resolveBy: 'id',
        id: 0,
      },
      algod
    );

    v8Client = new ResourcePackerv8Client(
      {
        sender: testAccount,
        resolveBy: 'id',
        id: 0,
      },
      algod
    );

    await v9Client.create.createApplication({});
    await v8Client.create.createApplication({});
  });

  test('same account', async () => {
    const { algod, testAccount } = fixture.context;
    const v8atc = await v8Client.compose().addressBalance({ addr: testAccount.addr }).atc();
    const v9atc = await v9Client.compose().addressBalance({ addr: testAccount.addr }).atc();

    const atc = new algosdk.AtomicTransactionComposer();

    const v8Call = v8atc.buildGroup()[0];
    const v9Call = v9atc.buildGroup()[0];

    v8Call.txn.group = undefined;
    v9Call.txn.group = undefined;

    atc.addTransaction(v8Call);
    atc.addTransaction(v9Call);

    const packedAtc = await packResources(fixture.context.algod, atc);

    const v8CallAccts = packedAtc.buildGroup()[0].txn.appAccounts;
    const v9CallAccts = packedAtc.buildGroup()[1].txn.appAccounts;

    expect(v8CallAccts!.length + v9CallAccts!.length).toBe(1);
    await packedAtc.execute(algod, 3);
  });

  test('app account', async () => {
    const { algod } = fixture.context;

    await v8Client.appClient.fundAppAccount(algokit.microAlgos(300000));
    await v8Client.bootstrap({}, { sendParams: { fee: algokit.microAlgos(3_000) } });

    const externalAppID = (await v8Client.getGlobalState()).externalAppID!.asBigInt();

    const v8atc = await v8Client
      .compose()
      .externalAppCall({}, { sendParams: { fee: algokit.microAlgos(3_000) } })
      .atc();

    const v9atc = await v9Client
      .compose()
      .addressBalance({ addr: algosdk.getApplicationAddress(externalAppID) })
      .atc();

    const atc = new algosdk.AtomicTransactionComposer();

    const v8Call = v8atc.buildGroup()[0];
    const v9Call = v9atc.buildGroup()[0];

    v8Call.txn.group = undefined;
    v9Call.txn.group = undefined;

    atc.addTransaction(v8Call);
    atc.addTransaction(v9Call);

    const packedAtc = await packResources(fixture.context.algod, atc);

    const v8CallApps = packedAtc.buildGroup()[0].txn.appForeignApps;
    const v9CallAccts = packedAtc.buildGroup()[1].txn.appAccounts;

    expect(v8CallApps!.length + v9CallAccts!.length).toBe(1);
    await packedAtc.execute(algod, 3);
  });
});

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
