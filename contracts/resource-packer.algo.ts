import { Contract } from '@algorandfoundation/tealscript';

class ExternalApp extends Contract {
  dummy(): void {}
}

// eslint-disable-next-line no-unused-vars
class ResourcePackerv8 extends Contract {
  programVersion = 8;

  externalAppID = GlobalStateKey<Application>();

  asa = GlobalStateKey<Asset>();

  smallBoxKey = BoxKey<bytes>({ key: 's' });

  mediumBoxKey = BoxKey<bytes>({ key: 'm' });

  bootstrap(): void {
    sendMethodCall<[], void>({
      name: 'createApplication',
      approvalProgram: ExternalApp.approvalProgram(),
      clearStateProgram: ExternalApp.clearProgram(),
      localNumByteSlice: ExternalApp.schema.local.numByteSlice,
      globalNumByteSlice: ExternalApp.schema.global.numByteSlice,
      globalNumUint: ExternalApp.schema.global.numUint,
      localNumUint: ExternalApp.schema.local.numUint,
    });

    this.externalAppID.value = this.itxn.createdApplicationID;

    this.asa.value = sendAssetCreation({
      configAssetTotal: 1,
    });
  }

  addressBalance(addr: Address): void {
    assert(addr.balance);
  }

  smallBox(): void {
    this.smallBoxKey.value = '';
  }

  mediumBox(): void {
    this.mediumBoxKey.create(5_000);
  }

  externalAppCall(): void {
    sendMethodCall<[], void>({
      applicationID: this.externalAppID.value,
      name: 'dummy',
    });
  }

  assetTotal(): void {
    assert(this.asa.value.total);
  }

  hasAsset(addr: Address): void {
    assert(!addr.hasAsset(this.asa.value));
  }
}
