/** Replace `location.reload` for the duration of one test. */
export function stubReload() {
  const reload = vi.fn();
  const descriptor = Object.getOwnPropertyDescriptor(window, 'location');
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { reload },
  });
  return {
    reload,
    restore() {
      if (descriptor) Object.defineProperty(window, 'location', descriptor);
    },
  };
}
