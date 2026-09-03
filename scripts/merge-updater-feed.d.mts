export interface UpdaterFeedFile {
  url: string;
  sha512: string;
  size?: number;
}

export interface UpdaterFeed {
  version: string;
  files: UpdaterFeedFile[];
  path?: string;
  sha512?: string;
  releaseDate?: string;
}

export function mergeUpdaterFeeds(docs: ReadonlyArray<UpdaterFeed>): UpdaterFeed;
