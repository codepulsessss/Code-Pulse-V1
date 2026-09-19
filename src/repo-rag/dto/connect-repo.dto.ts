import { IsOptional, IsString, IsUrl, MinLength, ValidateIf } from 'class-validator';

export class ConnectRepoDto {
  /**
   * GitHub workspace as "owner/repo" (preferred).
   */
  @ValidateIf((o: ConnectRepoDto) => !o.owner || !o.repo)
  @IsString()
  @MinLength(3)
  workspace?: string;

  @ValidateIf((o: ConnectRepoDto) => !o.workspace)
  @IsString()
  @MinLength(1)
  owner?: string;

  @ValidateIf((o: ConnectRepoDto) => !o.workspace)
  @IsString()
  @MinLength(1)
  repo?: string;

  @IsString()
  @MinLength(1)
  branch!: string;

  /**
   * Optional override. Defaults to PUBLIC_WEBHOOK_URL from env.
   */
  @IsOptional()
  @IsUrl(
    {
      protocols: ['http', 'https'],
      require_protocol: true,
      require_tld: false,
    },
    { message: 'webhookUrl must be a valid http(s) URL' },
  )
  webhookUrl?: string;
}
