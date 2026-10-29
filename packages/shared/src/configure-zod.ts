import { z } from 'zod';

// Imported before any schema module. Zod reads jitless when an object schema
// is created and otherwise compiles it with `new Function`.
z.config({ jitless: true });
