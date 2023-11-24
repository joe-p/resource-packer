import algosdk from 'algosdk';

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

export async function packResources(algod: algosdk.Algodv2, atc: algosdk.AtomicTransactionComposer) {
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
