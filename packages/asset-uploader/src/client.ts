import type { AssetData } from "./utils/get-asset-data";

export type AssetClient = {
  uploadFile: (
    name: string,
    type: string,
    data: AsyncIterable<Uint8Array>,
    assetInfoFallback:
      | { width: number; height: number; format: string }
      | undefined
  ) => Promise<AssetData>;
  /**
   * Streams an uploaded file back, or resolves to undefined when there is no
   * such file. Only clients whose files live off the server have one: the
   * /cgi routes read the fs client's directory themselves.
   */
  readFile?: (
    name: string,
    options?: { range?: string }
  ) => Promise<Response | undefined>;
};
