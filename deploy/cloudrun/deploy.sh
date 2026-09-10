#!/usr/bin/env bash
# Deploy the publisher to Cloud Run Jobs, scheduled by Cloud Scheduler. Run from the repo root after
# `gcloud auth login` and `gcloud config set project <id>`. Every command is idempotent.
#
# Two secrets, neither in the image:
#   1. the env file (CRE_ETH_PRIVATE_KEY, 1INCH_API_KEY, SECRET_* gains), from ~/.zentis/cre.env,
#      mounted read-only from Secret Manager at /secrets/cre.env;
#   2. the CRE login session (~/.cre/cre.yaml and context.yaml). The CLI refreshes the access token
#      on every run and rewrites cre.yaml, so it cannot be a read-only secret: it is seeded once
#      into a GCS bucket and mounted read-write as a volume at /root/.cre. If Auth0 rotates the
#      refresh token, the rewritten file is what keeps the next run logged in.
set -euo pipefail
PROJECT=${PROJECT:-$(gcloud config get-value project)}
REGION=${REGION:-us-central1}
REPO=${AR_REPO:-zentis}
IMAGE="$REGION-docker.pkg.dev/$PROJECT/$REPO/publisher:$(git rev-parse --short HEAD)"
BUCKET=${CRE_BUCKET:-$PROJECT-zentis-cre}

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com cloudscheduler.googleapis.com storage.googleapis.com
gcloud artifacts repositories describe "$REPO" --location "$REGION" >/dev/null 2>&1 \
  || gcloud artifacts repositories create "$REPO" --repository-format docker --location "$REGION"
gcloud builds submit --tag "$IMAGE" -f deploy/cloudrun/Dockerfile .

# 1. the env file
gcloud secrets describe zentis-cre-env >/dev/null 2>&1 || gcloud secrets create zentis-cre-env --replication-policy automatic
gcloud secrets versions add zentis-cre-env --data-file "$HOME/.zentis/cre.env"

# 2. the login session, seeded once (re-run this block after a fresh `cre login` if it ever expires)
gsutil ls -b "gs://$BUCKET" >/dev/null 2>&1 || gsutil mb -l "$REGION" "gs://$BUCKET"
gsutil cp "$HOME/.cre/cre.yaml" "$HOME/.cre/context.yaml" "gs://$BUCKET/"

for which in fast slow; do
  gcloud run jobs describe "zentis-$which" --region "$REGION" >/dev/null 2>&1 && verb=update || verb=create
  gcloud run jobs "$verb" "zentis-$which" --region "$REGION" --image "$IMAGE" --args "$which" \
    --memory 2Gi --cpu 1 --task-timeout 15m --max-retries 0 \
    --set-secrets "/secrets/cre.env=zentis-cre-env:latest" \
    --add-volume "name=cre,type=cloud-storage,bucket=$BUCKET" --add-volume-mount "volume=cre,mount-path=/root/.cre"
done

SA="$(gcloud run jobs describe zentis-fast --region "$REGION" --format 'value(template.template.serviceAccount)')"
for spec in "fast:*/5 * * * *" "slow:7 * * * *"; do
  which=${spec%%:*}; cron=${spec#*:}
  uri="https://$REGION-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$PROJECT/jobs/zentis-$which:run"
  gcloud scheduler jobs describe "zentis-$which" --location "$REGION" >/dev/null 2>&1 && verb=update || verb=create
  gcloud scheduler jobs "$verb" http "zentis-$which" --location "$REGION" --schedule "$cron" \
    --uri "$uri" --http-method POST --oauth-service-account-email "${SA:-$PROJECT@appspot.gserviceaccount.com}"
done
echo "deployed $IMAGE; run one now with: gcloud run jobs execute zentis-fast --region $REGION --wait"
