import { z } from "zod";

export const signalSchema = z.object({
  signal_id: z.string().min(1).optional(),
  component_id: z.string().min(1),
  component_type: z.string().min(1),
  message: z.string().min(1),
  timestamp: z.string().datetime(),
  trace_id: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type SignalInput = z.infer<typeof signalSchema>;