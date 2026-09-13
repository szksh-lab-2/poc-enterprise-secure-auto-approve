// A thin GitHub REST API client.
// This module is independent of the approval rule, so it can be reused by other approve logic.

export type PullRequest = {
  changed_files: number;
  head: {
    sha: string;
  };
};

export type PullRequestFile = {
  filename: string;
  // previous_filename is set only if the file is renamed.
  previous_filename?: string;
};

// GitHub's "List pull requests files" API returns at most 3000 files.
// https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files
export const maxChangedFiles = 3000;

const perPage = 100;

export type Repository = {
  owner: string;
  repo: string;
};

export const parseRepository = (repository: string): Repository => {
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    throw new Error(`a repository must be <owner>/<repo>: ${repository}`);
  }
  return { owner: owner, repo: repo };
};

export class Client {
  private readonly token: string;
  private readonly baseURL: string;

  constructor(token: string, baseURL = "https://api.github.com") {
    this.token = token;
    this.baseURL = baseURL;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const resp = await fetch(`${this.baseURL}${path}`, {
      method: method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!resp.ok) {
      throw new Error(
        `${method} ${path} failed: ${resp.status} ${await resp.text()}`,
      );
    }
    return (await resp.json()) as T;
  }

  private async getAll<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; ; page++) {
      const sep = path.includes("?") ? "&" : "?";
      const list = await this.request<T[]>(
        "GET",
        `${path}${sep}per_page=${perPage}&page=${page}`,
      );
      items.push(...list);
      if (list.length < perPage) {
        return items;
      }
    }
  }

  getPullRequest(repo: Repository, prNumber: number): Promise<PullRequest> {
    return this.request<PullRequest>(
      "GET",
      `/repos/${repo.owner}/${repo.repo}/pulls/${prNumber}`,
    );
  }

  listPullRequestFiles(
    repo: Repository,
    prNumber: number,
  ): Promise<PullRequestFile[]> {
    return this.getAll<PullRequestFile>(
      `/repos/${repo.owner}/${repo.repo}/pulls/${prNumber}/files`,
    );
  }
}
