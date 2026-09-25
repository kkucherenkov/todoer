# 14. Registration is owner-first; reset has two paths

- **Status:** accepted
- **Date:** 2026-09-25

## Context

A self-hosted instance has no operator to run account recovery, and may have no
outbound mail at all. It may also be exposed to the internet by accident.

## Decision

Registration is open only while the instance has no users: the first account
becomes the owner, and after that new accounts require an invitation token the
owner issues.

Password reset has two paths. When SMTP is configured, `forgot` sends a link.
When it is not, the endpoint says so plainly rather than pretending, and
recovery goes one of two ways: the owner resets **another** user's password
through an owner-only API route, using the ordinary client; and the owner's
**own** recovery requires server access, through a one-shot command run on the
host. The client CLI is not that command — see
[0015](0015-the-cli-is-a-client-for-automation.md); it is a client and has no
privileged path into the database.

## Consequences

An instance that is accidentally reachable does not accumulate strangers'
accounts, which open registration on a self-hosted product reliably produces.

Mail becomes optional rather than required. A typical home instance sends no
mail, and making SMTP mandatory would mean a forgotten password is a permanent
lockout on exactly the deployments most likely to hit it.

The shell is treated as a legitimate recovery channel for the owner, which is
true for self-hosted and false for cloud. Other users never need it: the owner
can reset them over the API from anywhere. The SMTP path exists so that nobody
has to ask.

`forgot` answers identically whether or not the address is known, so the
endpoint cannot be used to enumerate accounts. The same rule applies to
`login`.

Account deletion purges the user's rows rather than tombstoning them. Their
other devices simply stop authenticating; there is no one left to synchronise
with.
