import mongoose, { Schema, Document } from "mongoose";

export interface RawSignalDocument extends Document {
  component_id: string;
  component_type: string;
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
  work_item_id?: string;
  received_at: Date;
  signal_id?: string;
  trace_id?: string;
}

const rawSignalSchema = new Schema<RawSignalDocument>(
  {
    component_id: { type: String, required: true, index: true },
    component_type: { type: String, required: true },
    message: { type: String, required: true },
    timestamp: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed },
    work_item_id: { type: String, index: true },
    received_at: { type: Date, default: Date.now, index: true },
    signal_id: { type: String, index: true, unique: true, sparse: true },
    trace_id: { type: String, index: true },
  },
  { versionKey: false }
);

export const RawSignalModel = mongoose.model<RawSignalDocument>(
  "RawSignal",
  rawSignalSchema
);