import { z } from "zod";

export const rcaBodySchema = z.object({
  incidentStart: z.string().datetime(),
  incidentEnd: z.string().datetime(),
  rootCauseCategory: z.string().min(1),
  fixApplied: z.string().min(1),
  preventionSteps: z.string().min(1),
});

export type RcaBody = z.infer<typeof rcaBodySchema>;