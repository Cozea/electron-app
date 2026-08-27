import type {
  GitActionProgressEvent,
  GitCheckoutInput,
  GitCreateBranchInput,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullInput,
  GitPullResult,
  GitPullRequestRefInput,
  GitRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  GitRunStackedActionResult,
  GitStatusInput,
  GitStatusResult,
} from "@cozea/assistant-contracts";
import { WS_METHODS } from "@cozea/contracts";

import { T3EffectRpcClient } from "./effectRpcClient";

export interface T3VcsClientOptions {
  readonly client: T3EffectRpcClient;
}

/** Native T3 Effect RPC VCS client (Phase T5). */
export class T3VcsClient {
  private readonly client: T3EffectRpcClient;
  private vcsProgressUnsubscribe: (() => Promise<void>) | null = null;
  private readonly progressListeners = new Set<(event: GitActionProgressEvent) => void>();

  constructor(options: T3VcsClientOptions) {
    this.client = options.client;
  }

  async pull(input: GitPullInput): Promise<GitPullResult> {
    return (await this.client.callUnary(WS_METHODS.vcsPull, input)) as GitPullResult;
  }

  async status(input: GitStatusInput): Promise<GitStatusResult> {
    return (await this.client.callUnary(WS_METHODS.vcsRefreshStatus, input)) as GitStatusResult;
  }

  async listBranches(input: GitListBranchesInput): Promise<GitListBranchesResult> {
    return (await this.client.callUnary(WS_METHODS.vcsListRefs, input)) as GitListBranchesResult;
  }

  async createWorktree(input: GitCreateWorktreeInput): Promise<GitCreateWorktreeResult> {
    return (await this.client.callUnary(
      WS_METHODS.vcsCreateWorktree,
      input,
    )) as GitCreateWorktreeResult;
  }

  async removeWorktree(input: GitRemoveWorktreeInput): Promise<void> {
    await this.client.callUnary(WS_METHODS.vcsRemoveWorktree, input);
  }

  async createBranch(input: GitCreateBranchInput): Promise<void> {
    await this.client.callUnary(WS_METHODS.vcsCreateRef, input);
  }

  async checkout(input: GitCheckoutInput): Promise<void> {
    await this.client.callUnary(WS_METHODS.vcsSwitchRef, input);
  }

  async init(input: GitInitInput): Promise<void> {
    await this.client.callUnary(WS_METHODS.vcsInit, input);
  }

  async resolvePullRequest(input: GitPullRequestRefInput): Promise<GitResolvePullRequestResult> {
    return (await this.client.callUnary(
      WS_METHODS.gitResolvePullRequest,
      input,
    )) as GitResolvePullRequestResult;
  }

  async preparePullRequestThread(
    input: GitPreparePullRequestThreadInput,
  ): Promise<GitPreparePullRequestThreadResult> {
    return (await this.client.callUnary(
      WS_METHODS.gitPreparePullRequestThread,
      input,
    )) as GitPreparePullRequestThreadResult;
  }

  async runStackedAction(input: GitRunStackedActionInput): Promise<GitRunStackedActionResult> {
    return (await this.client.callUnary(
      WS_METHODS.gitRunStackedAction,
      input,
    )) as GitRunStackedActionResult;
  }

  private async ensureVcsProgressSubscription(): Promise<void> {
    if (this.vcsProgressUnsubscribe) {
      return;
    }
    this.vcsProgressUnsubscribe = await this.client.openStream(
      WS_METHODS.subscribeVcsStatus,
      {},
      (item) => {
        const record = item as GitActionProgressEvent;
        for (const listener of this.progressListeners) {
          listener(record);
        }
      },
    );
  }

  async onActionProgress(listener: (event: GitActionProgressEvent) => void): Promise<() => void> {
    this.progressListeners.add(listener);
    await this.ensureVcsProgressSubscription();
    return () => {
      this.progressListeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    this.progressListeners.clear();
    if (this.vcsProgressUnsubscribe) {
      await this.vcsProgressUnsubscribe();
      this.vcsProgressUnsubscribe = null;
    }
  }
}
