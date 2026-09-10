# The scheduled publisher as a Cloud Run job: one image, two jobs (fast, slow), each run by Cloud
# Scheduler. The workflows read their secrets from a mounted env file and the CRE CLI needs a
# login session, which it refreshes and REWRITES on every run; see deploy.sh for how both are
# mounted. Nothing secret is baked into the image.
FROM oven/bun:1.2 AS base
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates git util-linux \
 && rm -rf /var/lib/apt/lists/*
# The CRE CLI. Pin the version the repository was built against (cre --version on the dev machine).
ARG CRE_VERSION=1.32.0
RUN curl -fsSL "https://github.com/smartcontractkit/cre-cli/releases/download/v${CRE_VERSION}/cre_${CRE_VERSION}_linux_amd64.tar.gz" \
    | tar -xz -C /usr/local/bin cre && cre --version
WORKDIR /zentis
COPY packages/strategy-sdk packages/strategy-sdk
COPY cre cre
COPY scripts/publisher.sh scripts/publisher.sh
RUN cd cre/fast && bun install --frozen-lockfile && cd ../slow && bun install --frozen-lockfile
# ~/.cre is a mounted volume at run time (the login session); ~/.zentis/cre.env a mounted secret.
ENV HOME=/root ZENTIS_CRE_ENV=/secrets/cre.env ZENTIS_LOG_DIR=/tmp/zentis-logs
ENTRYPOINT ["/zentis/scripts/publisher.sh"]
