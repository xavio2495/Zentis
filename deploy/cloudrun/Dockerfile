# The scheduled publisher as a Cloud Run job: one image, one job, one schedule every five minutes
# (see tick.sh for why not two). The workflows read their secrets from a mounted env file and the CRE CLI needs a
# login session, which it refreshes and REWRITES on every run; see deploy.sh for how both are
# mounted. Nothing secret is baked into the image.
# Pinned to the dev machine's bun: the lockfiles are v2, which bun 1.2 cannot parse.
FROM oven/bun:1.4.2 AS base
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates git util-linux \
 && rm -rf /var/lib/apt/lists/*
# The CRE CLI. Pin the version the repository was built against (cre --version on the dev machine).
ARG CRE_VERSION=1.32.0
# The default linux build wants glibc 2.38; oven/bun is Debian bookworm (2.36), so take the
# ldd2-35 build. The archive holds one file named cre_v<version>_linux_amd64_ldd2-35.
RUN curl -fsSL "https://github.com/smartcontractkit/cre-cli/releases/download/v${CRE_VERSION}/cre_linux_amd64_ldd2-35.tar.gz" \
    | tar -xz -C /usr/local/bin && mv /usr/local/bin/cre_v* /usr/local/bin/cre && chmod +x /usr/local/bin/cre && cre version
WORKDIR /zentis
COPY packages/strategy-sdk packages/strategy-sdk
COPY cre cre
COPY scripts/publisher.sh scripts/publisher.sh
COPY deploy/cloudrun/tick.sh deploy/cloudrun/tick.sh
RUN cd cre/fast && bun install --frozen-lockfile && cd ../slow && bun install --frozen-lockfile
# ~/.cre is a mounted volume at run time (the login session); ~/.zentis/cre.env a mounted secret.
ENV HOME=/root ZENTIS_CRE_ENV=/secrets/cre.env ZENTIS_LOG_DIR=/tmp/zentis-logs
ENTRYPOINT ["/zentis/deploy/cloudrun/tick.sh"]
