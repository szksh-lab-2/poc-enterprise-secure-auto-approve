# The secret value isn't managed by Terraform.
# aws_secretsmanager_secret_version would store the value in the Terraform state
# in plaintext, so the value is set out of band (AWS CLI or the Web Console).
resource "aws_secretsmanager_secret" "github_auto_approve" {
  name        = "github-auto-approve"
  description = "A secret which only the github_auto_approve IAM role can read"
}

data "aws_iam_policy_document" "github_auto_approve_secret" {
  statement {
    sid     = "AllowGitHubAutoApproveRole"
    effect  = "Allow"
    actions = ["secretsmanager:GetSecretValue"]
    # A resource policy is attached to a single secret, so the resource is the secret itself.
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.github_auto_approve.arn]
    }
  }

  statement {
    sid     = "DenyEveryoneExceptGitHubAutoApproveRole"
    effect  = "Deny"
    actions = ["secretsmanager:GetSecretValue"]
    # Deny the action to every principal but the role, so that an identity-based
    # policy alone can't grant the access to the secret value.
    resources = ["*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "ArnNotEquals"
      variable = "aws:PrincipalArn"
      values   = [aws_iam_role.github_auto_approve.arn]
    }
  }
}

resource "aws_secretsmanager_secret_policy" "github_auto_approve" {
  secret_arn = aws_secretsmanager_secret.github_auto_approve.arn
  policy     = data.aws_iam_policy_document.github_auto_approve_secret.json
}
