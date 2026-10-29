import { adminMetricsInput } from '@repo/shared';
import type { TrpcBase } from '../../trpc/trpc-base';
import type { PrismaService } from '../prisma/prisma.service';
import { loadProductMetrics } from './product-metrics';

/** `admin.metrics` query. Admin role is enforced by `adminProcedure`. */
export function buildAdminMetricsProcedure(t: TrpcBase, prisma: PrismaService) {
  return t.adminProcedure.input(adminMetricsInput).query(({ input }) => {
    return loadProductMetrics(prisma, input);
  });
}
