import { z } from "zod";
// A caught Function probe also violates the dashboard's restrictive CSP.
z.config({ jitless: true });
