import { matchRoutes } from 'react-router';
import { appRoutes } from './app';

describe('app routes', () => {
  it('keeps the admin form paths on the data router', () => {
    const path = (url: string) => matchRoutes(appRoutes, url)?.at(-1)?.route.path;

    expect(path('/')).toBe('/');
    expect(path('/forum/new')).toBe('/forum/new');
    expect(path('/forum/some-topic')).toBe('/forum/:slug');
    expect(path('/admin/users')).toBe('/admin/users');
    expect(path('/admin/catalog/series/new')).toBe('/admin/catalog/series/new');
    expect(path('/admin/catalog/series/celestial-dawn/edit')).toBe(
      '/admin/catalog/series/:slug/edit',
    );
    expect(path('/admin/catalog/series/celestial-dawn/cards/new')).toBe(
      '/admin/catalog/series/:slug/cards/new',
    );
    expect(path('/admin/catalog/series/celestial-dawn')).toBe('/admin/catalog/series/:slug');
    expect(path('/admin/catalog/cards/aurora-knight/edit')).toBe('/admin/catalog/cards/:slug/edit');
    expect(path('/me/password')).toBe('/me/password');
    expect(path('/me')).toBe('/me');
    expect(path('/missing')).toBe('*');
  });
});
