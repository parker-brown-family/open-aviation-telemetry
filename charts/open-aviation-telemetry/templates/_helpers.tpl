{{/*
Naming and labelling helpers.

Every object the chart creates carries the same label set, so `kubectl get all
-l app.kubernetes.io/instance=<release>` returns the whole application and
nothing else. That is what makes a release inspectable and cleanly deletable.
*/}}

{{- define "oat.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "oat.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "oat.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Labels that identify the release. Safe to put on any object. */}}
{{- define "oat.labels" -}}
helm.sh/chart: {{ include "oat.chart" . }}
app.kubernetes.io/name: {{ include "oat.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: open-aviation-telemetry
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{/*
Selector labels for one workload.

Deliberately minimal and free of version information: a Deployment's selector is
immutable, so anything that changes between releases must not appear here or the
next upgrade fails with a rejected update.
*/}}
{{- define "oat.selectorLabels" -}}
app.kubernetes.io/name: {{ include "oat.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .name }}
{{- end -}}

{{/* The image for one workload. Falls back to the workload name. */}}
{{- define "oat.image" -}}
{{- $tag := .root.Values.image.tag | default .root.Chart.AppVersion -}}
{{- $name := .workload.imageName | default .name -}}
{{- printf "%s/%s:%s" .root.Values.image.registry $name $tag -}}
{{- end -}}

{{/*
Environment shared by every Node service.

Credentials come from secretKeyRef, never from a value: anything passed as a
value is visible in `helm get values` and in whatever CI system ran the upgrade.
*/}}
{{- define "oat.commonEnv" -}}
- name: NODE_ENV
  value: production
- name: LOG_LEVEL
  value: {{ .Values.config.logLevel | quote }}
- name: AWS_REGION
  value: {{ .Values.config.awsRegion | quote }}
- name: KAFKA_BROKERS
  value: {{ .Values.kafka.brokers | quote }}
- name: KAFKA_AUTH
  value: {{ .Values.kafka.auth | quote }}
- name: DATABASE_SSL
  value: {{ .Values.database.ssl | quote }}
- name: DATABASE_POOL_MAX
  value: {{ .Values.database.poolMax | quote }}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secrets.existingSecret }}
      key: {{ .Values.secrets.databaseUrlKey }}
- name: RABBITMQ_URL
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secrets.existingSecret }}
      key: {{ .Values.secrets.rabbitmqUrlKey }}
{{- end -}}
