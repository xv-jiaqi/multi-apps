import { Module } from '@nestjs/common';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { AuthRouter } from './auth.router';
import { TrpcBaseModule } from '../../trpc/trpc-base.module';

@Module({
  imports: [
    TrpcBaseModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => {
        const expiresIn = config.get<string>('JWT_EXPIRES_IN', '7d');
        return {
          secret: config.get<string>('JWT_SECRET', 'dev-insecure-secret'),
          signOptions: {
            // Cast widens the generated `ms.StringValue` union (e.g. `7d`, `2h`)
            // to `any` so arbitrary env-provided values compile without pulling
            // in the `ms` type package directly.
            expiresIn: expiresIn as unknown as number,
          },
        };
      },
    }),
  ],
  providers: [AuthService, JwtStrategy, AuthRouter],
  exports: [AuthService, AuthRouter, JwtModule],
})
export class AuthModule {}
