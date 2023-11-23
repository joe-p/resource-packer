import { Contract } from '@algorandfoundation/tealscript';

// eslint-disable-next-line no-unused-vars
class ResourcePackerv8 extends Contract {
  programVersion = 8;

  smallBoxKey = BoxKey<bytes>({ key: 's' });

  mediumBoxKey = BoxKey<bytes>({ key: 'm' });

  addressBalance(addr: Address): void {
    assert(addr.balance);
  }

  smallBox(): void {
    this.smallBoxKey.value = '';
  }

  mediumBox(): void {
    this.mediumBoxKey.create(5_000);
  }
}
