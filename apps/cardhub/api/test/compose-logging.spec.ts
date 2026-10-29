import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';

const repoRoot = path.resolve(__dirname, '../../../..');

const loggingSchema = z.object({
  driver: z.literal('json-file'),
  options: z.object({
    'max-size': z.literal('10m'),
    'max-file': z.literal('5'),
  }),
});

const renderedSchema = z.object({
  services: z.record(z.string(), z.object({ logging: loggingSchema }).loose()),
});

function renderCompose(file: string, extraArgs: string[] = []): z.infer<typeof renderedSchema> {
  const stdout = execFileSync(
    'docker',
    ['compose', '-f', file, ...extraArgs, 'config', '--format', 'json'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, ENV_NAME: 'prod' },
    },
  );
  return renderedSchema.parse(JSON.parse(stdout));
}

describe('compose log rotation', () => {
  it('sets json-file max-size and max-file on every deploy, edge, and dev service', () => {
    const deploy = renderCompose('deploy/docker-compose.yml', [
      '--env-file',
      'deploy/.env.example',
      '--profile',
      'migrate',
    ]);
    const edge = renderCompose('deploy/edge/docker-compose.yml', [
      '--env-file',
      'deploy/.env.example',
    ]);
    const dev = renderCompose('docker/docker-compose.yml', ['--profile', 'tools']);

    expect(Object.keys(deploy.services).sort()).toEqual([
      'api',
      'migrate',
      'postgres',
      'redis',
      'web',
    ]);
    expect(Object.keys(edge.services).sort()).toEqual(['caddy']);
    expect(Object.keys(dev.services).sort()).toEqual(['pgadmin', 'postgres', 'redis']);

    for (const services of [deploy.services, edge.services, dev.services]) {
      for (const service of Object.values(services)) {
        expect(service.logging).toEqual({
          driver: 'json-file',
          options: { 'max-size': '10m', 'max-file': '5' },
        });
      }
    }
  });
});
