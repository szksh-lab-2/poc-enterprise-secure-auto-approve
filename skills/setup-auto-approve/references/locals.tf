locals {
  # The branch which manages the auto approve reusable workflow in each repository.
  # The same branch name is created in every repository, because the default branch
  # and the branch flow differ per repository. The branch is protected by an
  # Organization Ruleset which requires a review by the security team, so the
  # workflow can't be changed without the review. The ruleset must also restrict
  # deletions and block force pushes, otherwise the reviewed branch could be
  # replaced instead of updated.
  auto_approve_branch = "auto-approve"

  # The reusable workflows which are shared by multiple repositories.
  # They're managed in a dedicated repository, and only the file names with the
  # auto_approve_ prefix are allowed so that the other workflows of the repository
  # can't assume the role. The branch is protected by the Organization Ruleset too.
  auto_approve_shared_workflow_ref = "szksh-lab-2/poc-enterprise-secure-auto-approve/.github/workflows/auto_approve_*.yaml@refs/heads/main"

  # The repositories which are allowed to assume the github_auto_approve role.
  # The repository isn't a wildcard, because a wildcard would also allow a repository
  # which is created later.
  # Add a repository only after its auto-approve branch has been created and
  # reviewed. A ruleset which requires a pull request doesn't block the push which
  # creates the branch, it blocks only the pushes which follow, so the content of
  # that first push is reviewed by adding the repository to this list rather than by
  # the ruleset. An orphan branch has to be created by a direct push anyway: it has
  # no common ancestor with the default branch, so it can't be created by a pull
  # request.
  auto_approve_repos = [
    "szksh-lab-2/poc-enterprise-secure-auto-approve",
  ]
}
