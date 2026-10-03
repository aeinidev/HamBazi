import { z } from "zod";

// Run before contract/schema imports: even a caught Function probe violates CSP.
z.config({ jitless: true });
