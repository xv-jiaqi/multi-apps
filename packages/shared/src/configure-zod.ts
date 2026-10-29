import { z } from 'zod';

// Imported before any schema module. Zod reads jitless when an object schema
// is created and otherwise compiles it with `new Function`.
// Checks without a custom message use the issue code, never Zod's English sentence.
z.config({
  jitless: true,
  customError: (issue) => {
    const code = issue.code;
    return typeof code === 'string' && code.length > 0 ? code : 'invalid';
  },
});
