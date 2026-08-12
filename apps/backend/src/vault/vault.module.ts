import { Global, Module } from '@nestjs/common';
import { VaultService } from './vault.service';
import { PasswordCryptoService } from './password-crypto.service';

@Global()
@Module({
  providers: [VaultService, PasswordCryptoService],
  exports: [VaultService, PasswordCryptoService],
})
export class VaultModule {}
