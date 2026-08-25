# Architecture decision records

One file per significant decision. Each says what was decided, why, what was
rejected and what it costs — because the rejected option and the cost are the
parts that are hard to reconstruct later, and the parts worth discussing.

A decision is recorded here when reversing it would mean changing more than one
component. Everything smaller belongs in a code comment next to the thing it
explains.

| #                                              | Decision                                                       | Status   |
| ---------------------------------------------- | -------------------------------------------------------------- | -------- |
| [0001](0001-terraform-is-canonical.md)         | Terraform owns deployed infrastructure; CDK is reference only  | Accepted |
| [0002](0002-eks-over-ecs.md)                   | Amazon EKS rather than ECS on Fargate                          | Accepted |
| [0003](0003-postgresql-on-rds.md)              | One PostgreSQL database, shared by three services              | Accepted |
| [0004](0004-kafka-for-telemetry.md)            | Kafka for the telemetry stream, partitioned by aircraft        | Accepted |
| [0005](0005-rabbitmq-for-work-items.md)        | RabbitMQ for jobs, alongside Kafka rather than instead of it   | Accepted |
| [0006](0006-synthetic-telemetry.md)            | Synthetic telemetry, never a real aviation data feed           | Accepted |
| [0007](0007-demo-mode-is-production-shaped.md) | The demo drives the real system                                | Accepted |
| [0008](0008-stream-before-projection.md)       | Publish to the stream before writing the projection            | Accepted |
| [0009](0009-explain-rather-than-implement.md)  | Document some production concerns instead of implementing them | Accepted |
| [0010](0010-honest-data-provenance.md)         | The client always states where its numbers came from           | Accepted |
| [0011](0011-two-fleet-views.md)                | A terrain basemap, falling back to a self-contained scope      | Accepted |
