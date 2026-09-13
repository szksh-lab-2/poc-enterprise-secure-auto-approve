# PoC of Enterprise Secure Auto Approve

このリポジトリは GitHub を使う開発組織でセキュアに auto approve を実現するための方法について説明します。
如何に auto approve の仕組みを悪用した不正な PR のマージを防ぐかというお話です。

## 前提

- 一定以上の規模の開発組織のリポジトリ (リポジトリが 100 個以上あるような規模感) に横断的に適用していく標準化されたスキームを考えます
  - OSS や個人プロジェクトはスコープ外
- GitHub で開発を行う
- 自動 approve をして良い条件についてはスコープ外
- PAT の管理に AWS Secrets Manager を使っていて AWS を前提にしていますが、 Google Cloud などでも同様なはずです
- fork は使わない前提です
  - enterprise で fork を許可するのはコードの漏洩などのリスクがあり、そもそも避けるべきです

## セキュアと言えない auto-approve

最初にセキュアと言えない auto-approve の例を紹介します。

1. 任意の PR を approve なしでマージできる
1. 任意の bot の approve でマージできる
1. codeowner の machine user の PAT が Organization Secret などから簡単に取れる

こういう状況では、悪意を持った内部の開発者や supply chain attack によって不正に PR をマージできてしまいます。

## 要点

セキュアな auto approve のための要点です。

- Branch Ruleset で auto approve する　PR の base branch を保護
  - Organization Ruleset で一元的に適用するのが望ましいが、難しければ Repository Ruleset で個別に適用する
- approve 専用の Machine User を用意
- AWS Secrets Manager などで PAT を管理し、 OIDC で許可された Reusable Workflow からのみ PAT を取得可能にする
  - OIDC の `sub` claim をカスタマイズし、 repository と workflow の組み合わせを一つの claim で固定する
    - Organization のテンプレートを設定するだけでは適用されず、リポジトリごとの opt in が必要
- 再利用できるコードは独立した repository で action, reusable workflow 化する
  - AWS Secrets Manager などから PAT を取得し、 approve
  - auto approve の可否を check する汎用的なロジック
- approve する Reusable Workflow (workflow_call) を作成
  - 各 repository 固有の workflow は各リポジトリの専用の branch `auto-approve` で管理
- approve する Reusable Workflow を Organization Ruleset で保護し、 security team などの review を必須にする
- 判定ロジックの action は `$/` で参照し、 PR の head のコードを使わない
- auto approve を許可するパスに、コードが実行されうるファイルを含めない
- Machine User の活動を監視する

## 作業手順

1. Organization Ruleset で `auto-approve` branch を保護
1. Organization の OIDC の `sub` claim をカスタマイズ
1. Set up (Machine User ごとに一度だけやればよい)
    1. Machine User の作成
    1. AWS Secrets Manager secret や IAM Role の作成
    1. fine-grained PAT を AWS Secrets Manager に保存
1. 再利用できるコードを独立した repository で action, reusable workflow 化
1. 各リポジトリで approve するための設定
    1. OIDC の `sub` claim のカスタマイズに opt in
    1. Branch Ruleset で auto approve する　PR の base branch を保護
    1. Machine User に push 権限を付与し、 CODEOWNERS に追加
    1. (必要であれば) `auto-approve` branch に Reusable Workflow の作成 (branch の作成は Organization admin のみ)
    1. Reusable Workflow を呼び出すように Workflow を修正

### Organization Ruleset で `auto-approve` branch を保護

各リポジトリの Ruleset だと統制が難しいので、 Organization Ruleset で一元的に管理します。

Ruleset を 2 つ作成します。

Ruleset 1:

- Ruleset Name: `auto_approve`
- Bypass list: empty
- Target repositories: All repositories
- Target branches: `auto-approve`
- `Restrict deletions`
- `Require signed commits`
- `Require a pull request before merging`
  - `Dismiss stale pull request approvals when new commits are pushed`
  - `Require review from Code Owners`
    - CODEOWNERS ファイルは PR の base branch のものが適用されるので、 `auto-approve` ブランチに専用の CODEOWNERS ファイルを置く
    - 代わりに `Require review from specific teams` で Organization Ruleset 側で一律に設定するのもあり
  - `Require approval of the most recent reviewable push`
- `Require status checks to pass`
  - check: `status-check` 名前は何でもよいが、 Reusable Workflow をテストする job を追加する
- `Block force pushes`

Ruleset 2:

- Ruleset Name: `forbid_create_auto_approve_branch`
- Bypass list: Organization admin
- Target repositories: All repositories
- Target branches: `auto-approve`
- `Restrict creations`

なお、 Ruleset 1 では `Require a pull request before merging` が有効なので、 `auto-approve` branch に直接 push は通常出来ませんが、 branch を作成する際はこの制約が適用されず、 push することが出来ます。
これは Ruleset 1 を有効にしても `auto-approve` branch を作成する事ができるという良い面がある一方、 branch を作成する際は Ruleset 1 による制約が効かないので PAT を悪用する workflow を追加できてしまうという危険な側面もあります。
そこで、 `auto-approve` ブランチを作成できる人を Organization admin に限定します。
Organization admin であっても Ruleset 1 の bypass は認めたくないので Ruleset を 2 つに分けています。

#### Ruleset 1 の `Require status checks to pass`

固定で単一の job を必須にします。複数の job を指定したい場合、
https://zenn.dev/shunsuke_suzuki/articles/how-to-manage-github-actions-required-status-check で説明している方法で単一の job に集約します。

### Organization の OIDC の `sub` claim をカスタマイズ

https://docs.github.com/en/rest/actions/oidc?apiVersion=2022-11-28#set-the-customization-template-for-an-oidc-subject-claim-for-an-organization

GitHub Actions の OIDC token の `sub` claim は、デフォルトでは `repo:<owner>/<repo>:ref:refs/heads/<branch>` という形式で `job_workflow_ref` を含みません。
そのため、 Organization の設定で `sub` claim に `repo` と `job_workflow_ref` を含めるようにカスタマイズします。

```sh
gh api -X PUT "/orgs/$ORG/actions/oidc/customization/sub" \
  -f 'include_claim_keys[]=repo' \
  -f 'include_claim_keys[]=job_workflow_ref'
```

これにより `sub` は `repo:<owner>/<repo>:job_workflow_ref:<job_workflow_ref>` という形式になります。

repository と workflow を別々の condition で指定すると、両者の組み合わせが総当たりで評価され、あるリポジトリが対になっていない別のリポジトリの workflow を使うことを許してしまいます。
一つの `sub` claim にまとめることで、 repository と workflow の組み合わせを固定できます。

AWS の IAM Role の Assume Role Policy で OIDC token の condition に使えるのは `sub`, `aud`, `amr` だけで、 `token.actions.githubusercontent.com:job_workflow_ref` のような condition key は存在しません。
`job_workflow_ref` を `sub` に含めるカスタマイズが必須なのはこのためです。

#### リポジトリごとに opt in する

Organization のテンプレートは、設定しただけでは各リポジトリに適用されません。
リポジトリ側が `use_default: true` のままだと GitHub のデフォルトの `sub` が使われ続けます。
リポジトリごとに `use_default: false` を設定して opt in する必要があります。

```sh
gh api -X PUT "/repos/$ORG/$REPO/actions/oidc/customization/sub" \
  --input - <<< '{"use_default":false}'
```

現在の設定は GET で確認できます。

```sh
gh api "/repos/$ORG/$REPO/actions/oidc/customization/sub"
```

opt in を忘れると、 IAM Role 側を正しく設定していても `sub` が一致せず、 `AccessDenied: Not authorized to perform sts:AssumeRoleWithWebIdentity` になります。
一方で opt in するとそのリポジトリの全ての workflow の `sub` が変わるため、同じリポジトリで OIDC を使っている他の IAM Role などの condition も併せて修正する必要があります。

この endpoint を GitHub App の token で叩く場合、 `actions:write` 権限が必要です。
REST API のドキュメントには classic PAT の `repo` scope しか記載がありません。

#### immutable subject claims

2026-07-15 以降に作成・リネーム・移譲されたリポジトリでは、 immutable subject claims が自動的に有効になります。
この場合 `sub` の repository 部分に owner ID と repository ID が埋め込まれます。

```
repo:<owner>@<owner_id>/<repo>@<repo_id>:job_workflow_ref:<job_workflow_ref>
```

ID は一度採番されると再利用されないため、リポジトリのリネームや削除・再作成によって別のリポジトリが同じ `sub` を名乗る subject recycling を防げます。
`include_claim_keys` をカスタマイズしても repository 部分から ID を外すことは出来ません。

ID が入るのは repository 部分だけで、 `job_workflow_ref` 部分は名前ベースのままです。

e.g.

```
repo:szksh-lab-2@204274656/poc-enterprise-secure-auto-approve@1366980709:job_workflow_ref:szksh-lab-2/poc-enterprise-secure-auto-approve/.github/workflows/auto_approve.yaml@refs/heads/auto-approve
```

repository 部分は GET で返る `sub_claim_prefix` そのものです。

immutable subject claims の有効・無効は Organization とリポジトリで別々に設定でき、リポジトリ側が優先されます。
Organization 側が `use_immutable_subject: false` でもリポジトリ側が `true` なら immutable 形式で発行されるので、 Assume Role Policy を書く前にリポジトリ側の設定を確認して下さい。

- https://github.blog/changelog/2026-04-23-immutable-subject-claims-for-github-actions-oidc-tokens/

### Machine User の作成

auto-approve 専用の Machine User を作成します。
GitHub の仕様上、 GitHub App は codeowner になれないので、 Machine User が必要です。
他の用途でも同じ Machine User の PAT を使っていると、その PAT を悪用されて approve される危険性が高まります。
そのため、他の用途では用いないようにし、ユーザー及び PAT を厳重に管理します。
auto approve したいリポジトリの数が多い場合、リポジトリごとに Machine User を用意するのは非現実的なので、共有の Machine User を使います。

### AWS Secrets Manager secret や IAM Role の作成

Terraform: [skills/setup-auto-approve/references](skills/setup-auto-approve/references) を参考にして下さい。

Terraform を CI で実行して管理する場合、そのコードも Branch Ruleset で適切に管理して下さい。
そうでないと不正に PAT を取得できてしまう可能性があります。
Assume Role Policy や Resource Based Policy が Update されたら Slack に通知するなど、ログを残したり監視する仕組みを整えることも重要です。

- IAM Role: PAT を取得できる IAM Role
  - Assume Role Policy:
    - OIDC で repository, job_workflow_ref で許可
    - repository のリストを local value で管理し、 repository を追加すれば良いようにする
- IAM Role Policy
  - `secretsmanager:GetSecretValue`
- AWS Secrets Manager Secret
  - secret value は Terraform で管理しない
- AWS Secrets Manager Secret Policy
  - `secretsmanager:GetSecretValue` を専用 IAM Role から許可し、それ以外の principal からは deny する
    - SRE などが強い権限を持ってしまっている場合でも、 resource based policy で制限する

Assume Role Policy の repository のリストでは、基本的には glob は使わず、一つ一つ指定することにします。
glob を使って任意の repository で許可すると、 `auto-approve` branch がない repository に不正な workflow を追加して PAT を悪用される危険性があります。
リポジトリの追加に逐次 review を挟むことでこのような不正を防止します。

また、 `sub` claim は `repo:<A>:job_workflow_ref:<B>/.github/workflows/auto_approve.yaml@refs/heads/auto-approve` という形式なので、 A と B の両方を glob にすると A と B が異なる組み合わせにも一致してしまいます。
リポジトリ A が リポジトリ B の workflow を呼び出し、 B の緩い判定ロジックで A の PR を approve させられます。
組織の中で最も緩いリポジトリの基準が組織全体に適用されることになるので、 repository と workflow は必ず対にして指定します。

Terraform であれば `github_repositories` data source でリポジトリのリストを取得し、リポジトリごとに自身の workflow と対にした値を生成することでこれを避けられます。
ただしこの場合、新しく作成されたリポジトリが apply のたびに自動的に追加されるため、リポジトリの追加に review を挟めなくなる点には注意が必要です。

immutable subject claims が有効なリポジトリでは A に owner ID と repository ID が入るため、リポジトリ名だけでは値を生成できません。
Terraform で組み立てる場合は data source からリポジトリと Organization の数値 ID を取得する必要があります。
有効・無効はリポジトリごとに異なりうるので、実際に発行される `sub` を確認してから値を組み立てて下さい。

### fine-grained PAT を AWS Secrets Manager に保存

`pull-requests:write` 権限のみを持つ fine-grained PAT を作成します。

repository access は auto approve が必要なリポジトリのみに限定します。
共有の Machine User を使う以上、 PAT が漏洩したときの影響範囲を決めるのはこの設定です。
`All repositories` にすると、漏洩時に Organization 全体の PR を approve できてしまいます。

fine-grained PAT には必ず有効期限があるので、更新の運用も決めておきます。

- 期限が近づいたら通知する仕組みを用意し、期限切れで auto approve が止まることに気づけるようにする
- 更新は AWS Secrets Manager の secret value を差し替えるだけで済むようにする

### 再利用できるコードを独立した repository で action, reusable workflow 化

- approve のためのよくあるロジック (e.g. 特定のファイルのみの更新であれば approve)
- AWS Secrets Manager からの PAT の取得
- approve
  - review の `commit_id` を固定する必要があるため、 `gh pr review -a` ではなく API を直接呼びます

共有の Reusable Workflow を IAM Role の `job_workflow_ref` で許可する場合、 workflow のファイル名を `auto_approve_*.yaml` のように限定します。
このリポジトリには auto approve と無関係な workflow も置かれるため、ファイル名を限定しないとそれらの workflow からも IAM Role を assume できてしまいます。

### Branch Ruleset で auto approve する　PR の base branch を保護

- `Require review from Code Owners` を有効化
  - これを有効にしないと push 権限を持つ任意のユーザーや bot で approve してマージできてしまいます。
- Ruleset の bypass list を空にする
- `Dismiss stale pull request approvals when new commits are pushed`
- `Require approval of the most recent reviewable push`

これらがないと、 auto approve された後に新しい commit を push し、 check されていないコードをそのままマージできてしまいます。
approve 用の Reusable Workflow が review の `commit_id` を固定しているのも、これらの設定と組み合わせて初めて意味を持ちます。

### Machine User に push 権限を付与し、 CODEOWNERS に追加

CODEOWNERS に追加するには repository の push 権限が必要なので付与します。
auto approve したい PR の base branch の CODEOWNERS に追加します。
auto approve したい PR で変更されうるファイルのみに限定します。

e.g. CODEOWNERS

```
staging/** @approve-bot
```

どのパスを対象にするかは、この仕組みの中で最も慎重に決めるべき部分です。
以下のようなファイルは、人の review を経ずにマージされると影響が大きいので、対象に含めるかどうかは特に慎重に判断して下さい。

- `.github/`: workflow は CI で実行されるコードそのものなので、そのリポジトリの secrets を使った任意のコードを実行できる。 CODEOWNERS を `.github/CODEOWNERS` に置いている場合は CODEOWNERS の書き換えにもなる
- `CODEOWNERS`: 以降の PR の codeowner を書き換えられる
- 依存関係の lock file や manifest: 悪意のある依存を引き込める
- ビルド設定やスクリプト (`Makefile`, `package.json` の `scripts` など): CI で任意のコードを実行できる

基本的にはデータのみを置くディレクトリに限定し、コードが実行されうるパスは含めないのが安全です。
ここで問題になるのは auto approve の仕組みそのものではなく、リポジトリの CI が乗っ取られることです。
判定ロジックと approve の処理自体は `auto-approve` branch にあり `$/` で参照されるので、これらのファイルを書き換えられても差し替えられません。

一方で、 Dependabot や Renovate による action の update を自動マージしたい、というのは現実的な要求です。
この場合、パスだけで判断するのをやめて、 PR の author や commit の内容も条件に加えることになります。
パスによる限定よりも判断が難しくなるので、少なくとも以下は確認して下さい。

- PR の全ての commit が 信頼できる bot によるものであることを確認する
  - author だけを見ても不十分で、 bot の branch には他のユーザーも commit を push できる
  - commit の author や committer の email は自由に設定できるため、署名を検証する (`verification.verified` と signer) のが確実
- 変更の内容自体を限定する
  - action の SHA と version comment の更新のみ、といった形に限定できれば、 bot が信頼できることだけに依存せずに済む

なお、 Dependabot が作成した PR の workflow でも `permissions` キー自体は尊重されるので `id-token: write` は指定できるので、今回の仕組みは問題なく動きます。

https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-on-actions
https://github.blog/changelog/2021-10-06-github-actions-workflows-triggered-by-dependabot-prs-will-respect-permissions-key-in-workflows/

### (必要であれば) `auto-approve` branch に Reusable Workflow の作成

先述の Organization Ruleset の制約により、この作業は Organization admin のみが行なえます。

特定のリポジトリ専用の auto approve logic を実装したい場合、そのリポジトリに `auto-approve` branch を作成し、そこに Reusable Workflow を配置します。

orphan branch `auto-approve` を作成します。

```sh
git switch --orphan auto-approve
```

CODEOWNERS を push します。

e.g. auto-approve branch の全ファイルに security team を CODEOWNERS に追加する

```
* @szksh-lab-2/security
```

```sh
git add CODEOWNERS
git commit -m "chore: initialize auto-approve branch"
git push -u origin auto-approve
```

その後 auto-approve branch に PR を投げて approve のための Reusable Workflow を作成します。
code review を強制するために最初の push には含めないようにします。

```
README.md
CODEOWNERS
.github/
  workflows/
    auto_approve.yaml # approve 用の Reusable Workflow
  actions/
    auto_approve/ # リポジトリ固有の auto approve 判定のロジック
      action.yaml
      ...
```

Example:

- https://github.com/szksh-lab-2/poc-enterprise-secure-auto-approve/tree/auto-approve
- [.github/workflows/auto_approve.yaml](https://github.com/szksh-lab-2/poc-enterprise-secure-auto-approve/blob/auto-approve/.github/workflows/auto_approve.yaml)
- [.github/actions/auto_approve](https://github.com/szksh-lab-2/poc-enterprise-secure-auto-approve/tree/auto-approve/.github/actions/auto_approve)

[validate-pr-review-app](https://github.com/suzuki-shunsuke/validate-pr-review-app) で auto-approve branch を保護すると望ましいです。

### Reusable Workflow を呼び出すように Workflow を修正

auto approve を実行したい workflow に job を追加し、 approve 用の reusable workflow を呼び出します。

.github/workflows/test.yaml:

```yaml
on: pull_request
jobs:
  approve:
    uses: szksh-lab-2/poc-enterprise-secure-auto-approve/.github/workflows/auto_approve.yaml@auto-approve
    permissions:
      contents: read # To resolve the action in the reusable workflow's repository
      pull-requests: read # To list the updated files of the pull request
      id-token: write # To get an OIDC token to assume the AWS IAM role
```

このとき、 action を full-length commit SHA で pinning すると SHA の更新の度に OIDC の job_workflow_ref claim の修正が必要になって面倒です。
そのため、 branch 指定を許容します。

## 補足

### GitHub Secrets ではだめなのか

今回 PAT は GitHub Secrets ではなく、 AWS Secrets Manager を使っています。
最大の理由は、 GitHub Secrets には「特定の workflow からのみ参照できる」という制限を表現する手段がないことです。
この仕組みは approve 用の Reusable Workflow だけが PAT を取得できることに依存しているので、そこが満たせないと成立しません。

GitHub Secrets には幾つか種類がありますが、どれも PAT を管理するには適当ではありません。

- Organization Secrets
  - repository ごとに公開範囲を絞ることは出来るが、 branch や workflow では制限できない
  - 対象の repository に workflow を追加できる人なら誰でも参照できてしまう
- Repository Secrets
  - workflow で制限できないのは Organization Secrets と同じ
  - リポジトリごとに secret を作成する必要があり、 PAT の管理や rotation が煩雑になる
- Environment Secrets
  - deployment branch policy や required reviewers で保護できるが、 auto approve の job は PR の context で実行されるため branch で絞る運用には馴染まない
  - required reviewers を使うと人の承認が必要になり、自動化の意味がなくなる
  - 結局その environment を参照する workflow を追加すれば参照できてしまう
  - リポジトリごとの管理になる点は Repository Secrets と同じ
- Dependabot Secrets
  - Dependabot の PR では Actions secrets が使えないため代わりに使いたくなるが、性質は Organization Secrets や Repository Secrets と同じで、 workflow で制限できない

また、いずれもアクセスログが残りません。
AWS Secrets Manager であれば CloudTrail に記録が残るため、想定外のアクセスを検知できます。

### approve する Reusable Workflow の置き場

リポジトリ固有のロジックを実装する workflow は、同じリポジトリで管理しつつ security team などの review を必須にします。
専用のリポジトリに集約すると、数が増えたときにスケールしづらくなりますし、管理が煩雑になります。

### 専用の branch `auto-approve` で管理する

- リポジトリの個別の事情に左右されずに Organization Ruleset で保護できる
- OIDC で制限する際も branch が固定のほうが都合が良い

default branch で管理する場合と比べたときのデメリット:

- default branch の変更と同じ PR で auto-approve の workflow を修正できない
- default branch を修正する際に、 auto-approve 側に必要な修正を忘れやすい

Organization 全体で default branch や branch flow が統一されているなら default branch でも良いと思いますが、一定以上の規模の開発組織だと難しいかもしれません。

### リポジトリ固有の複雑なロジックはスクリプトで記述し、単体テストなどを整備する

- run step や github-script はメンテが困難だし auto-approve のロジックの実装に穴があると危険なので避ける
- reusable workflow から独立したスクリプトを呼ぶ場合、 composite action または JS action にする

### 判定ロジックの action は `$/` で参照する

`$/` は、その workflow を実行している ref と同じ ref のリポジトリを指す記法です。
approve 用の Reusable Workflow は `auto-approve` branch という固定の ref で呼び出されるので、 `$/` で参照される action も `auto-approve` branch のもの、つまり Organization Ruleset で保護され review されたコードになります。

```yaml
- uses: $/.github/actions/auto_approve
```

`./.github/actions/auto_approve` のように checkout したコードを参照してはいけません。
それは PR の head の内容、つまり PR の作成者が書き換えられるコードなので、判定ロジックを常に approve するものに差し替えられてしまいます。

- https://github.blog/changelog/2026-07-30-reference-same-repository-actions-with-self-repository-syntax/

### PAT を扱う job では untrusted な入力を展開しない

PAT と AWS の認証情報は approve 用の Reusable Workflow の job に存在します。
この job の `run` に `${{ }}` で PR のタイトルやブランチ名などを展開すると、 script injection によって認証情報を外部に送出されてしまいます。

- PR に由来する値は `env` 経由で渡し、 `run` に直接展開しない
- 共有の Reusable Workflow が `inputs` を受け取る場合も、それを `run` に直接展開しない

### 実際の `sub` claim を確認する

Assume Role に失敗したときは、まず実際に発行された `sub` を確認します。
Organization とリポジトリの設定の組み合わせで形式が変わるため、推測で Assume Role Policy を書くと合わせるのが難しいです。

AWS では CloudTrail の `AssumeRoleWithWebIdentity` イベントに記録されます。
Assume Role に失敗したイベントでも `sub` は記録されるため、これが最も手軽です。

```sh
aws cloudtrail lookup-events --region us-east-1 \
  --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRoleWithWebIdentity \
  --start-time 2026-09-13T13:00:00Z \
  --query 'Events[].CloudTrailEvent' --output text |
  tr '\t' '\n' |
  jq -r '.eventTime + " " + (.errorCode // "OK") + " " + .userIdentity.userName'
```

`userIdentity.userName` が `sub` です。
STS の global endpoint を使う場合、イベントは `us-east-1` に記録されます。
CloudTrail への反映には数分かかります。

GitHub 側で確認したい場合は [github/actions-oidc-debugger](https://github.com/github/actions-oidc-debugger) で token の claim を出力できます。
ただし claim をログに出すことになるので、常設せず確認時のみ使って下さい。

### Machine User の活動を監視する

仕組みで防ぎきれなかった場合に気づけるよう、 Machine User の活動を監視します。

- Machine User による approve を記録し、想定外のリポジトリやパスでの approve をアラートする
- Machine User が approve 以外の操作 (push, PR の作成, 設定変更など) を行った場合にアラートする
- Organization の audit log で `auto-approve` branch の作成や Ruleset の変更を監視する
- AWS では IAM Role の assume と secret の取得を CloudTrail で記録する

### approve 判定の action と approve する action の分離

- check する action だけをテストしやすい
- 判定にサードパーティの action を使ったとしてもその action に PAT を渡す必要がないため、 PAT が漏洩する危険性を軽減できる

## 参考

- https://zenn.dev/shunsuke_suzuki/articles/secure-github-actions-by-job-workflow-ref
- https://zenn.dev/shunsuke_suzuki/scraps/1d711e9708e6cc
