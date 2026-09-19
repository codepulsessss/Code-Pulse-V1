import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export const PUSH_ANALYSIS_RUN_STATUSES = [
  'running',
  'completed',
  'failed',
] as const;

export type PushAnalysisRunStatus =
  (typeof PUSH_ANALYSIS_RUN_STATUSES)[number];

@Schema({ timestamps: true, collection: 'PushAnalysisRuns' })
export class PushAnalysisRun {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true, index: true })
  owner!: string;

  @Prop({ required: true, trim: true, index: true })
  repo!: string;

  @Prop({ required: true, trim: true, index: true })
  branch!: string;

  @Prop({ required: true, trim: true })
  beforeSha!: string;

  @Prop({ required: true, trim: true })
  afterSha!: string;

  @Prop({
    required: true,
    enum: PUSH_ANALYSIS_RUN_STATUSES,
    default: 'running',
  })
  status!: PushAnalysisRunStatus;

  @Prop({ type: MongooseSchema.Types.Mixed })
  finalReport?: Record<string, unknown>;

  @Prop()
  error?: string;
}

export type PushAnalysisRunDocument = HydratedDocument<PushAnalysisRun>;
export const PushAnalysisRunSchema =
  SchemaFactory.createForClass(PushAnalysisRun);

PushAnalysisRunSchema.index({
  userId: 1,
  owner: 1,
  repo: 1,
  branch: 1,
  createdAt: -1,
});
