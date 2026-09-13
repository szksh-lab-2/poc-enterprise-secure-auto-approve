resource "aws_iam_role" "github_auto_approve" {
  name               = "github_auto_approve"
  description        = "Read the secret github-auto-approve from AWS Secrets Manager"
  assume_role_policy = data.aws_iam_policy_document.github_auto_approve_assume_role.json
}

data "aws_iam_policy_document" "github_auto_approve" {
  statement {
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.github_auto_approve.arn]
  }
}

resource "aws_iam_role_policy" "github_auto_approve" {
  name   = "github_auto_approve"
  role   = aws_iam_role.github_auto_approve.id
  policy = data.aws_iam_policy_document.github_auto_approve.json
}

data "aws_iam_openid_connect_provider" "github_actions" {
  url = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "github_auto_approve_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github_actions.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      # The organization customizes the sub claim to include repo and
      # job_workflow_ref, so that both the caller repository and the workflow which
      # defines the job are restricted by a single condition. Two conditions would
      # be evaluated as the cross product of the repositories and the workflows,
      # which would allow a repository to use a workflow it isn't paired with.
      # StringLike, because the file name of a shared workflow is a wildcard.
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = concat(
        # Each repository calls the reusable workflow it manages on its own
        # auto-approve branch.
        [
          for repo in local.auto_approve_repos :
          "repo:${repo}:job_workflow_ref:${repo}/.github/workflows/auto_approve.yaml@refs/heads/${local.auto_approve_branch}"
        ],
        # The job can also be defined by a reusable workflow which is shared by
        # multiple repositories.
        # The branch of the caller isn't restricted, so any branch of the repository
        # can call the shared workflow. That's fine because the shared workflow
        # fetches the pull request and decides by itself whether it can be approved,
        # so a caller can only choose which pull request is evaluated.
        # The shared workflow must not interpolate its inputs into a run block
        # though: the AWS credentials and the secret live in its job, so a script
        # injection there would leak them.
        [
          for repo in local.auto_approve_repos :
          "repo:${repo}:job_workflow_ref:${local.auto_approve_shared_workflow_ref}"
        ],
      )
    }
  }
}
