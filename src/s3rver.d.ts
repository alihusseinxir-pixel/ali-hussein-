// Minimal typing for the dev-only S3-compatible test server.
declare module "s3rver" {
  export default class S3rver {
    constructor(options: { port?: number; address?: string; silent?: boolean; directory: string; configureBuckets?: { name: string; configs: unknown[] }[] });
    run(): Promise<{ port: number } | string>;
    close(): Promise<void>;
  }
}
