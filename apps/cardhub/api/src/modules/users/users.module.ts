import { Module } from '@nestjs/common';
import { TrpcBaseModule } from '../../trpc/trpc-base.module';
import { UsersRouter } from './users.router';

@Module({
  imports: [TrpcBaseModule],
  providers: [UsersRouter],
  exports: [UsersRouter],
})
export class UsersModule {}
