# Security policy

Kite moves real money, so we take reports seriously and will work with you to fix them.

## Reporting a vulnerability

Email **momoreoluwaadedeji@gmail.com** with:

- what the issue is and what an attacker could do with it
- where it is: the endpoint, page or file, and the commit or version you looked at
- steps or a request that reproduces it, if you have one

Please don't open a public issue, pull request or discussion about it, and don't test it against a Kite server you don't run yourself.

## What happens next

- We reply within 3 working days to confirm we've received it.
- We keep you updated while we investigate and fix it.
- Once a fix is released, we publish the details and credit you, unless you'd rather stay anonymous.

## In scope

- This server: its API, authentication and request signing, the dashboard and the public checkout
- How it handles keys, the operator wallet and encrypted settings
- The `@kite-01/sdk` and `@kite-01/js` packages from [Kite-01/monorepo](https://github.com/Kite-01/monorepo)

Contract issues go to the same address; see the [contracts security policy](https://github.com/Kite-01/contracts/blob/main/SECURITY.md). Issues in third-party dependencies should go to those projects, though we'd like to hear if one affects Kite.
