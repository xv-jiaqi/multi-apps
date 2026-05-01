import { Global, Module } from '@nestjs/common';
import { TrpcBase } from './trpc-base';

@Global()
@Module({
  providers: [TrpcBase],
  exports: [TrpcBase],
})
export class TrpcBaseModule {}
