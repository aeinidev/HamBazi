import { z } from "zod";
import { ticketSchema } from "../../platform/contracts.js";

export const currentKahrobaSearchSchema = ticketSchema.extend({
  status: z.enum(["SEARCHING", "RESERVED", "MATCHED"]),
  capacity: z.number().int().min(2).max(4),
});
