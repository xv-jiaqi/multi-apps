import { Module } from '@nestjs/common';
import { TrpcBaseModule } from '../../trpc/trpc-base.module';
import { NotificationsRouter } from './notifications.router';

@Module({
  imports: [TrpcBaseModule],
  providers: [NotificationsRouter],
  exports: [NotificationsRouter],
})
export class NotificationsModule {}
