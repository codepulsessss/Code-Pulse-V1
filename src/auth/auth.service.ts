import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Clients, ClientsDocument } from '../schemas/user.schema.js';
import { AuthenticatedUser } from './types/authenticated-user.type.js';

export type JwtPayload = {
  sub: string;
  email: string;
  provider: Clients['provider'];
  githubUsername?: string;
};

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(Clients.name) private readonly clientsModel: Model<Clients>,
    private readonly jwtService: JwtService,
  ) {}

  async validateAndGetUser(userId: string) {
    const client = await this.clientsModel.findById(userId).exec();
    if (!client) {
      throw new NotFoundException('User not found');
    }

    return this.toSafeUser(client);
  }

  async upsertGithubUser(params: {
    githubId: string;
    githubUsername: string;
    email: string;
    encryptedAccessToken: string;
  }) {
    let client = await this.clientsModel
      .findOne({ githubId: params.githubId })
      .exec();

    if (!client) {
      client = await this.clientsModel.findOne({ email: params.email }).exec();
    }

    if (client) {
      client.githubId = params.githubId;
      client.githubUsername = params.githubUsername;
      client.githubAccessToken = params.encryptedAccessToken;
      client.provider = 'github';
      await client.save();
    } else {
      client = await this.clientsModel.create({
        email: params.email,
        provider: 'github',
        githubId: params.githubId,
        githubUsername: params.githubUsername,
        githubAccessToken: params.encryptedAccessToken,
      });
    }

    const safeUser = this.toSafeUser(client);
    const accessToken = await this.signAccessToken({
      userId: safeUser._id.toString(),
      email: safeUser.email,
      provider: safeUser.provider,
      githubUsername: safeUser.githubUsername,
    });

    return { client: safeUser, accessToken };
  }

  async getGithubAccessToken(userId: string) {
    const client = await this.clientsModel
      .findById(userId)
      .select('+githubAccessToken')
      .exec();

    if (!client?.githubAccessToken) {
      throw new UnauthorizedException(
        'GitHub is not connected for this account.',
      );
    }

    return client.githubAccessToken;
  }

  private async signAccessToken(params: AuthenticatedUser) {
    const payload: JwtPayload = {
      sub: params.userId,
      email: params.email,
      provider: params.provider,
      githubUsername: params.githubUsername,
    };
    return this.jwtService.signAsync(payload);
  }

  private toSafeUser(
    client: ClientsDocument | (Clients & { _id: { toString(): string } }),
  ) {
    const json =
      'toJSON' in client && typeof client.toJSON === 'function'
        ? client.toJSON()
        : { ...client };
    delete json.githubAccessToken;
    return json;
  }
}
