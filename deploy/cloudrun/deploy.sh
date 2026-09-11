#!/usr/bin/env bash
# Deploy the publisher as one Cloud Run Job on one Cloud Scheduler entry (tick.sh explains why one). Run from the repo root after
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
# Two service accounts: the job runs as zentis-publisher (reads the secret, reads and rewrites the
# CRE session in the bucket); Cloud Scheduler calls the jobs as zentis-scheduler (run.invoker only).
RUN_SA="zentis-publisher@$PROJECT.iam.gserviceaccount.com"
SCHED_SA="zentis-scheduler@$PROJECT.iam.gserviceaccount.com"
for sa in zentis-publisher zentis-scheduler; do
  gcloud iam service-accounts describe "$sa@$PROJECT.iam.gserviceaccount.com" >/dev/null 2>&1 \
    || gcloud iam service-accounts create "$sa" --display-name "$sa"
done
gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$SCHED_SA" --role roles/run.invoker >/dev/null

gcloud artifacts repositories describe "$REPO" --location "$REGION" >/dev/null 2>&1 \
  || gcloud artifacts repositories create "$REPO" --repository-format docker --location "$REGION"
gcloud builds submit --config deploy/cloudrun/cloudbuild.yaml --substitutions "_IMAGE=$IMAGE" .

# 1. the env file
gcloud secrets describe zentis-cre-env >/dev/null 2>&1 || gcloud secrets create zentis-cre-env --replication-policy automatic
gcloud secrets versions add zentis-cre-env --data-file "$HOME/.zentis/cre.env"
gcloud secrets add-iam-policy-binding zentis-cre-env --member "serviceAccount:$RUN_SA" --role roles/secretmanager.secretAccessor >/dev/null

# 2. the login session, seeded once (re-run this block after a fresh `cre login` if it ever expires)
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 || gcloud storage buckets create "gs://$BUCKET" --location "$REGION" --uniform-bucket-level-access
gcloud storage cp "$HOME/.cre/cre.yaml" "$HOME/.cre/context.yaml" "gs://$BUCKET/"
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member "serviceAccount:$RUN_SA" --role roles/storage.objectAdmin >/dev/null

# One job, one schedule: tick.sh runs fast every five minutes and slow in the first slot of each
# hour, in the same instance, so the two publishers never sign with the shared key at once.
gcloud run jobs describe zentis-publisher --region "$REGION" >/dev/null 2>&1 && verb=update || verb=create
gcloud run jobs "$verb" zentis-publisher --region "$REGION" --image "$IMAGE" --args tick \
  --memory 2Gi --cpu 1 --task-timeout 4m --max-retries 0 --service-account "$RUN_SA" \
  --set-secrets "/secrets/cre.env=zentis-cre-env:latest" \
  --add-volume "name=cre,type=cloud-storage,bucket=$BUCKET" --add-volume-mount "volume=cre,mount-path=/root/.cre"

uri="https://$REGION-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$PROJECT/jobs/zentis-publisher:run"
gcloud scheduler jobs describe zentis-publisher --location "$REGION" >/dev/null 2>&1 && verb=update || verb=create
gcloud scheduler jobs "$verb" http zentis-publisher --location "$REGION" --schedule "*/5 * * * *" \
  --uri "$uri" --http-method POST --oauth-service-account-email "$SCHED_SA"
echo "deployed $IMAGE; run one now with: gcloud run jobs execute zentis-publisher --region $REGION --args fast --wait"
