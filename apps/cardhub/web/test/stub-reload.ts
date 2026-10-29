/** Replace `location.reload` for the duration of one test. */
export function stubReload() {
  const reload = vi.fn();
  const { pathname } = window.location;
  const descriptor = Object.getOwnPropertyDescriptor(window, 'location');
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { reload, pathname },
  });
  return {
    reload,
    restore() {
      if (descriptor) Object.defineProperty(window, 'location', descriptor);
    },
  };
}
