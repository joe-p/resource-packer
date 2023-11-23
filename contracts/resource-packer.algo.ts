import { Contract } from '@algorandfoundation/tealscript';

// eslint-disable-next-line no-unused-vars
class ResourcePackerv8 extends Contract {
  programVersion = 8;

  addressBalance(addr: Address): void {
    assert(addr.balance);
  }
}
