import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ClientsDocument = HydratedDocument<Clients>;
export const AUTH_PROVIDERS = ['github'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

@Schema({ timestamps: true, collection: 'Clients' })
export class Clients {
  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
  })
  email!: string;

  @Prop({
    required: true,
    enum: AUTH_PROVIDERS,
    default: 'github',
    index: true,
  })
  provider!: AuthProvider;

  @Prop({
    unique: true,
    sparse: true,
    index: true,
    trim: true,
  })
  githubId?: string;

  @Prop({ trim: true })
  githubUsername?: string;

  @Prop({ select: false })
  githubAccessToken?: string;
}

export const ClientsSchema = SchemaFactory.createForClass(Clients);
